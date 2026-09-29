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

  return async ({ mission, input }): Promise<AgentExecutionResult> => {
    const data = { ...objectInput(mission.input), ...objectInput(input) };
    const repoUrl =
      stringField(data, "repo_url", "repoUrl") ||
      env.OSA_BUILDER_DEFAULT_REPO_URL?.trim();

    if (!repoUrl) {
      throw new Error(
        "BUILD_CODE requires input.repo_url/repoUrl or OSA_BUILDER_DEFAULT_REPO_URL"
      );
    }

    const provider = resolveWorkspaceProvider(env, options.workspaceProvider);
    const selectedAgent = parseBuilderAgent(
      stringField(data, "selected_agent", "selectedAgent") ||
        env.OSA_BUILDER_AGENT?.trim()
    );

    const request: BuilderRequest = {
      taskId: mission.mission_id,
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
    const builder = new NativeBuilder({ workspaceProvider: provider });
    const result = await builder.run(request, (event) => {
      events.push(event);
    });

    const completed = result.status === "completed";
    const artifactStatus =
      completed && result.pushed
        ? "built"
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
              artifactStatus === "built"
                ? undefined
                : result.error ||
                  (artifactStatus === "no_changes"
                    ? "builder completed without repository changes"
                    : "native builder did not produce a pushed artifact"),
          },
          content,
        },
      ],
    };
  };
}
