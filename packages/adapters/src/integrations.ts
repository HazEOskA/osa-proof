import { AgentExecutionContext, AgentExecutionResult, AgentExecutor, EvidenceInput } from "../../contracts/src";

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export type OsaCapability =
  | "BUILD_CODE"
  | "RUN_TOOL"
  | "AGENT_TASK"
  | "VERIFY"
  | "AUTONOMOUS_CYCLE"
  | "FLEET_CHAT";

export class IntegrationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationConfigError";
  }
}

export interface BuilderBridgeConfig {
  baseUrl: string;
  token: string;
  defaultRepoUrl?: string;
  selectedAgent: string;
  selectedModel?: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

export interface ExecutionForceConfig {
  baseUrl: string;
  apiKey: string;
  environment: string;
  timeoutMs: number;
}

export interface OsaAgentConfig {
  baseUrl: string;
  uiToken: string;
  timeoutMs: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  timeoutMs: number;
}

export interface IntegrationConfig {
  enabled: boolean;
  builder?: BuilderBridgeConfig;
  executionForce?: ExecutionForceConfig;
  osaAgent?: OsaAgentConfig;
  fleet?: FleetConfig;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new IntegrationConfigError(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalFiniteNumber(
  value: string | undefined,
  name: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new IntegrationConfigError(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function normalizedBaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IntegrationConfigError(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IntegrationConfigError(`${name} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
}

function pairedSecretConfig(
  env: Env,
  urlName: string,
  secretName: string
): { baseUrl: string; secret: string } | undefined {
  const rawUrl = env[urlName]?.trim();
  const secret = env[secretName]?.trim();
  if (!rawUrl && !secret) return undefined;
  if (!rawUrl || !secret) {
    throw new IntegrationConfigError(`${urlName} and ${secretName} must be configured together`);
  }
  return { baseUrl: normalizedBaseUrl(rawUrl, urlName), secret };
}

export function loadIntegrationConfig(env: Env): IntegrationConfig {
  const enabled = env.OSA_INTEGRATION_ENABLED?.trim() === "1";
  if (!enabled) return { enabled: false };

  const builderPair = pairedSecretConfig(env, "OSA_BUILDER_BASE_URL", "OSA_BUILDER_BRIDGE_TOKEN");
  const executionPair = pairedSecretConfig(
    env,
    "OSA_EXECUTION_FORCE_BASE_URL",
    "OSA_EXECUTION_FORCE_API_KEY"
  );
  const agentPair = pairedSecretConfig(env, "OSA_AGENT_BASE_URL", "OSA_AGENT_UI_TOKEN");
  const fleetBaseUrl = env.OSA_FLEET_BASE_URL?.trim();

  return {
    enabled: true,
    builder: builderPair
      ? {
          baseUrl: builderPair.baseUrl,
          token: builderPair.secret,
          defaultRepoUrl: env.OSA_BUILDER_DEFAULT_REPO_URL?.trim() || undefined,
          selectedAgent: env.OSA_BUILDER_AGENT?.trim() || "claude",
          selectedModel: env.OSA_BUILDER_MODEL?.trim() || undefined,
          pollIntervalMs: positiveInteger(env.OSA_BUILDER_POLL_INTERVAL_MS, 1000, "OSA_BUILDER_POLL_INTERVAL_MS"),
          timeoutMs: positiveInteger(env.OSA_BUILDER_TIMEOUT_MS, 600000, "OSA_BUILDER_TIMEOUT_MS"),
        }
      : undefined,
    executionForce: executionPair
      ? {
          baseUrl: executionPair.baseUrl,
          apiKey: executionPair.secret,
          environment: env.OSA_EXECUTION_FORCE_ENVIRONMENT?.trim() || "development",
          timeoutMs: positiveInteger(
            env.OSA_EXECUTION_FORCE_TIMEOUT_MS,
            120000,
            "OSA_EXECUTION_FORCE_TIMEOUT_MS"
          ),
        }
      : undefined,
    osaAgent: agentPair
      ? {
          baseUrl: agentPair.baseUrl,
          uiToken: agentPair.secret,
          timeoutMs: positiveInteger(env.OSA_AGENT_TIMEOUT_MS, 30000, "OSA_AGENT_TIMEOUT_MS"),
        }
      : undefined,
    fleet: fleetBaseUrl
      ? {
          baseUrl: normalizedBaseUrl(fleetBaseUrl, "OSA_FLEET_BASE_URL"),
          apiKey: env.OSA_FLEET_API_KEY?.trim() || undefined,
          model: env.OSA_FLEET_MODEL?.trim() || undefined,
          temperature: optionalFiniteNumber(
            env.OSA_FLEET_TEMPERATURE,
            "OSA_FLEET_TEMPERATURE",
            0,
            2
          ),
          timeoutMs: positiveInteger(env.OSA_FLEET_TIMEOUT_MS, 90000, "OSA_FLEET_TIMEOUT_MS"),
        }
      : undefined,
  };
}

function objectInput(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergedMissionInput(context: Pick<AgentExecutionContext, "mission" | "input">): Record<string, unknown> {
  return { ...objectInput(context.mission.input), ...objectInput(context.input) };
}

function stringField(input: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function routeCapability(context: Pick<AgentExecutionContext, "mission" | "input">): OsaCapability {
  const input = mergedMissionInput(context);
  const explicit = stringField(input, "capability")?.toUpperCase();
  if (
    explicit === "BUILD_CODE" ||
    explicit === "RUN_TOOL" ||
    explicit === "AGENT_TASK" ||
    explicit === "VERIFY" ||
    explicit === "AUTONOMOUS_CYCLE" ||
    explicit === "FLEET_CHAT"
  ) {
    return explicit;
  }

  const objective = context.mission.objective
    .trim()
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/\b(fleet|agent fleet|fleet chat|gemini chat|conversation|rozmowa|czat fleety|flota agentow)\b/.test(objective)) {
    return "FLEET_CHAT";
  }
  if (/\b(autonomous cycle|money cycle|opportunity cycle|run now|business cycle|cykl autonomiczny|cykl pieniedzy|cykl okazji|odpal cykl|uruchom cykl|szukaj okazji)\b/.test(objective)) {
    return "AUTONOMOUS_CYCLE";
  }
  if (/\b(build|implement|code|fix|refactor|repository|repo|zbuduj|zbudowac|stworz|stworzyc|zaimplementuj|napraw|refaktor|kod|repozytorium)\b/.test(objective)) {
    return "BUILD_CODE";
  }
  if (/\b(run|execute|tool|skill|command|uruchom|wykonaj|narzedzie|komenda)\b/.test(objective)) {
    return "RUN_TOOL";
  }
  if (/\b(verify|verification|proof|audit|check|zweryfikuj|sprawdz|audyt|dowod)\b/.test(objective)) {
    return "VERIFY";
  }
  return "AGENT_TASK";
}

async function jsonResponse(response: Response, service: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${service} returned non-JSON HTTP ${response.status}`);
    }
  }
  if (!response.ok) {
    const record = objectInput(body);
    const detail =
      stringField(record, "error", "message", "detail") ||
      `HTTP ${response.status}`;
    throw new Error(`${service} request failed: ${detail}`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${service} returned an invalid response object`);
  }
  return body as Record<string, unknown>;
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  service: string
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await jsonResponse(
      await fetchImpl(url, { ...init, signal: controller.signal }),
      service
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${service} request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function routeEvidence(capability: OsaCapability, target: string): EvidenceInput {
  return {
    kind: "route",
    data: {
      status: "selected",
      capability,
      target,
      source: "osa-capability-router-v0.1",
    },
  };
}

function compactBuilderTask(task: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: task.id,
    status: task.status,
    branch_name: task.branchName,
    preview_url: task.previewUrl,
    pr_url: task.prUrl,
    pr_number: task.prNumber,
    error: task.error,
  };
}

export function createBuilderBridgeExecutor(
  config: BuilderBridgeConfig,
  fetchImpl: FetchLike = fetch
): AgentExecutor {
  return async ({ mission, input }): Promise<AgentExecutionResult> => {
    const data = { ...objectInput(mission.input), ...objectInput(input) };
    const repoUrl = stringField(data, "repo_url", "repoUrl") || config.defaultRepoUrl;
    if (!repoUrl) {
      throw new IntegrationConfigError(
        "BUILD_CODE requires input.repo_url/repoUrl or OSA_BUILDER_DEFAULT_REPO_URL"
      );
    }

    const prompt = stringField(data, "prompt", "task") || mission.objective;
    const selectedAgent = stringField(data, "selected_agent", "selectedAgent") || config.selectedAgent;
    const selectedModel = stringField(data, "selected_model", "selectedModel") || config.selectedModel;

    const created = await fetchWithTimeout(
      fetchImpl,
      `${config.baseUrl}/api/tasks`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          repoUrl,
          selectedAgent,
          selectedModel,
          installDependencies: Boolean(data.install_dependencies ?? data.installDependencies ?? false),
          keepAlive: false,
          enableBrowser: Boolean(data.enable_browser ?? data.enableBrowser ?? false),
        }),
      },
      Math.min(config.timeoutMs, 120000),
      "coding-agent-platform"
    );

    const createdTask = objectInput(created.task);
    const taskId = stringField(createdTask, "id");
    if (!taskId) throw new Error("coding-agent-platform did not return task.id");

    const startedAt = Date.now();
    let task = createdTask;
    while (true) {
      const status = stringField(task, "status") || "unknown";
      if (status === "completed" || status === "error" || status === "stopped") break;
      if (Date.now() - startedAt >= config.timeoutMs) {
        throw new Error(`coding-agent-platform task ${taskId} timed out after ${config.timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
      const polled = await fetchWithTimeout(
        fetchImpl,
        `${config.baseUrl}/api/tasks/${encodeURIComponent(taskId)}`,
        { headers: { authorization: `Bearer ${config.token}` } },
        Math.min(config.pollIntervalMs + 30000, config.timeoutMs),
        "coding-agent-platform"
      );
      task = objectInput(polled.task);
    }

    const status = stringField(task, "status") || "unknown";
    const completed = status === "completed";
    const compact = compactBuilderTask(task);
    const content = JSON.stringify(compact);

    return {
      output: { capability: "BUILD_CODE", service: "coding-agent-platform", task: compact },
      evidence: [
        {
          kind: "builder_task",
          data: {
            status: completed ? "completed" : status,
            source: "coding-agent-platform",
            task_id: taskId,
          },
          content,
        },
        {
          kind: "artifact",
          data: {
            status: completed ? "built" : "rejected",
            source: "coding-agent-platform",
            task_id: taskId,
            branch_name: compact.branch_name,
            preview_url: compact.preview_url,
            pr_url: compact.pr_url,
            reason: completed ? undefined : compact.error || `builder task ended with status ${status}`,
          },
          content,
        },
      ],
    };
  };
}

export function createExecutionForceExecutor(
  config: ExecutionForceConfig,
  fetchImpl: FetchLike = fetch
): AgentExecutor {
  return async ({ mission, input }): Promise<AgentExecutionResult> => {
    const data = { ...objectInput(mission.input), ...objectInput(input) };
    const response = await fetchWithTimeout(
      fetchImpl,
      `${config.baseUrl}/api/v2/missions/run`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          task: stringField(data, "task", "prompt") || mission.objective,
          goal: mission.objective,
          context: {
            requirements: mission.requirements.map((requirement) => requirement.requirement_id),
            known_facts: { input },
            repository: stringField(data, "repo_url", "repoUrl"),
            branch: stringField(data, "branch"),
            commit_sha: stringField(data, "commit_sha", "commitSha"),
          },
          environment: stringField(data, "environment") || config.environment,
          requested_operation: stringField(data, "requested_operation", "requestedOperation"),
          approvals: [],
        }),
      },
      config.timeoutMs,
      "osa-execution-force"
    );

    const state = stringField(response, "state", "status") || "UNKNOWN";
    const completed = /^(COMPLETED|COMPLETE|SUCCEEDED|SUCCESS|VERIFIED|DONE)$/i.test(state);
    const content = JSON.stringify(response);

    return {
      output: { capability: "RUN_TOOL", service: "osa-execution-force", result: response },
      evidence: [
        {
          kind: "execution_force_call",
          data: {
            status: completed ? "completed" : "non_terminal",
            source: "osa-execution-force",
            state,
            mission_id: response.mission_id,
            execution_id: response.execution_id,
          },
          content,
        },
        {
          kind: "artifact",
          data: {
            status: completed ? "built" : "rejected",
            source: "osa-execution-force",
            state,
            mission_id: response.mission_id,
            execution_id: response.execution_id,
            reason: completed ? undefined : `execution force returned non-terminal state ${state}`,
          },
          content,
        },
      ],
    };
  };
}

export interface CapabilityRouterOptions {
  fallback: AgentExecutor;
  builder?: AgentExecutor;
  executionForce?: AgentExecutor;
}

export function createCapabilityRouterExecutor(options: CapabilityRouterOptions): AgentExecutor {
  return async (context) => {
    const capability = routeCapability(context);
    let target = "native-runtime";
    let executor = options.fallback;

    if (capability === "BUILD_CODE") {
      if (!options.builder) throw new IntegrationConfigError("BUILD_CODE integration is not configured");
      target = "coding-agent-platform";
      executor = options.builder;
    } else if (capability === "RUN_TOOL") {
      if (!options.executionForce) throw new IntegrationConfigError("RUN_TOOL integration is not configured");
      target = "osa-execution-force";
      executor = options.executionForce;
    }

    const result = await executor(context);
    return {
      output: result.output,
      evidence: [routeEvidence(capability, target), ...result.evidence],
    };
  };
}
