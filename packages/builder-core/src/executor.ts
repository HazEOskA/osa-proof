import { createHmac, timingSafeEqual } from "node:crypto";
import { digest, canonicalJson } from "../../proof-core/src";
import type {
  AgentExecutionResult,
  AgentExecutor,
} from "../../contracts/src";
import {
  WorkspaceProviderNotConfiguredError,
  workspaceProviders,
  type WorkspaceProvider,
} from "../../workspace-runtime/src";
import { NativeBuilder } from "./builder";
import { parseBuilderAgent } from "./agents";
import type { BuilderCredentials, BuilderEvent, BuilderRequest } from "./types";

type Env = Record<string, string | undefined>;

export interface NativeBuilderExecutorOptions {
  env?: Env;
  workspaceProvider?: WorkspaceProvider;
}

function objectInput(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(
  input: Record<string, unknown>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function positiveInteger(
  value: string | undefined,
  fallback: number
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("OSA_NATIVE_BUILDER_TIMEOUT_MS must be a positive integer");
  }
  return parsed;
}

function resolveWorkspaceProvider(
  env: Env,
  explicit?: WorkspaceProvider
): WorkspaceProvider {
  if (explicit) return explicit;
  const providerId =
    env.OSA_WORKSPACE_PROVIDER?.trim() ||
    (env.OSA_WORKER_BASE_URL?.trim() && env.OSA_WORKER_TOKEN?.trim()
      ? "remote"
      : "docker");
  const provider = workspaceProviders.get(providerId);
  if (!provider) throw new WorkspaceProviderNotConfiguredError(providerId);
  return provider;
}

function credentials(env: Env): BuilderCredentials {
  return {
    githubToken: env.OSA_BUILDER_GITHUB_TOKEN?.trim() || undefined,
    anthropicApiKey:
      env.ANTHROPIC_API_KEY?.trim() ||
      env.OSA_BUILDER_ANTHROPIC_API_KEY?.trim() ||
      undefined,
    openaiApiKey:
      env.OPENAI_API_KEY?.trim() ||
      env.OSA_BUILDER_OPENAI_API_KEY?.trim() ||
      undefined,
  };
}

export function createNativeBuilderExecutor(
  options: NativeBuilderExecutorOptions = {}
): AgentExecutor {
  const env = options.env ?? process.env;

  return async ({ mission, input, execution_id }): Promise<AgentExecutionResult> => {
    const data = { ...objectInput(mission.input), ...objectInput(input) };
    const repoUrl =
      stringField(data, "repo_url", "repoUrl") ||
      env.OSA_BUILDER_DEFAULT_REPO_URL?.trim();

    if (!repoUrl) {
      throw new Error(
        "BUILD_CODE requires input.repo_url/repoUrl or OSA_BUILDER_DEFAULT_REPO_URL"
      );
    }

    let repo:URL;
    try{repo=new URL(repoUrl);}catch{throw Error("BUILDER_REPO_URL_INVALID");}
    const allowed=(env.OSA_BUILDER_ALLOWED_REPOSITORIES||"HazEOskA/osa-proof,HazEOskA/Jeverson").split(",");
    if(repo.protocol!=="https:"||repo.hostname!=="github.com"||repo.username||repo.password||repo.search||repo.hash||
      !allowed.includes(repo.pathname.slice(1).replace(/\.git$/,"")))throw Error("BUILDER_REPOSITORY_DENIED");
    // Signed per-execution grant is issued by a trusted operator service, never
    // by an LLM or a request boolean. The environment switch alone is insufficient.
    const approval=objectInput(data.builder_approval);
    const secret=env.OSA_BUILDER_APPROVAL_SECRET;
    const expires=Number(approval.expires_at);
    const prompt=stringField(data,"prompt","task")||mission.objective;
    const grant={action:"BUILD_PATCH",execution_id,repo_url:repoUrl,prompt_sha256:digest(prompt),branch:stringField(data,"branch","branch_name","branchName")||null,agent:stringField(data,"selected_agent","selectedAgent")||env.OSA_BUILDER_AGENT||"claude",model:stringField(data,"selected_model","selectedModel")||env.OSA_BUILDER_MODEL||null,install_dependencies:Boolean(data.install_dependencies??data.installDependencies??false),expires_at:expires};
    const expected=secret&&secret.length>=32?createHmac("sha256",secret).update(canonicalJson(grant)).digest("hex"):"";
    const signature=String(approval.signature||"");
    if(!expected||!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+300000||
       !/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))
      throw Error("BUILDER_EXPLICIT_APPROVAL_REQUIRED");
    const provider = resolveWorkspaceProvider(env, options.workspaceProvider);
    const selectedAgent = parseBuilderAgent(
      stringField(data, "selected_agent", "selectedAgent") ||
        env.OSA_BUILDER_AGENT?.trim()
    );

    const request: BuilderRequest = {
      taskId: mission.mission_id,
      executionId: execution_id,
      scope: { organization_id:mission.organization_id, project_id:mission.project_id, mission_id:mission.mission_id, task_id:execution_id },
      repoUrl,
      prompt: stringField(data, "prompt", "task") || mission.objective,
      branchName: stringField(data, "branch", "branch_name", "branchName"),
      selectedAgent,
      selectedModel:
        stringField(data, "selected_model", "selectedModel") ||
        env.OSA_BUILDER_MODEL?.trim() ||
        undefined,
      installDependencies: Boolean(
        data.install_dependencies ?? data.installDependencies ?? false
      ),
      timeoutMs: positiveInteger(
        env.OSA_NATIVE_BUILDER_TIMEOUT_MS,
        30 * 60_000
      ),
      gitAuthorName: env.OSA_BUILDER_GIT_AUTHOR_NAME?.trim() || "OSA Builder",
      gitAuthorEmail:
        env.OSA_BUILDER_GIT_AUTHOR_EMAIL?.trim() ||
        "osa-builder@users.noreply.github.com",
      credentials: credentials(env),
    };

    const events: BuilderEvent[] = [];
    const builder = new NativeBuilder({ workspaceProvider: provider,authorizeMutation:()=>true });
    const result = await builder.run(request, (event) => {
      events.push(event);
    });

    const completed = result.status === "completed";
    const artifactStatus =
      completed && !!result.patch_sha256
        ? "patch_ready"
        : completed && !result.changed
          ? "no_changes"
          : "rejected";

    const safeResult = {
      ...result,
      events,
    };
    const content = JSON.stringify(safeResult);

    return {
      output: {
        capability: "BUILD_CODE",
        service: "osa-native-builder",
        result: safeResult,
      },
      evidence: [
        {
          kind: "builder_task",
          data: {
            status: result.status,
            source: "osa-native-builder",
            workspace_provider: result.workspaceProvider,
            workspace_id: result.workspaceId,
            branch_name: result.branchName,
            changed: result.changed,
            pushed: result.pushed,
          },
          content,
        },
        {
          kind: "artifact",
          data: {
            status: artifactStatus,
            source: "osa-native-builder",
            branch_name: result.branchName,
            workspace_provider: result.workspaceProvider,
            reason:
              artifactStatus === "patch_ready"
                ? undefined
                : result.error ||
                  (artifactStatus === "no_changes"
                    ? "builder completed without repository changes"
                    : "native builder did not produce a reviewable patch"),
          },
          content,
        },
      ],
    };
  };
}
