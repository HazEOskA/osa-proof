import { createHash, randomUUID } from "node:crypto";
import type { AgentExecutor, Mission, TeamGraph, RunResult } from "../../../packages/contracts/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";

// One approved, read-only acceptance case. No caller-controlled URLs, hosts or methods.
export const TRACE_TASK = "OSA-TRACE-001";
export const TRACE_TARGET_ORIGIN = "https://osa-proof-gx6alklct-osabarca-1680s-projects.vercel.app";
export const TRACE_TARGETS = [
  { key: "layers", path: "/api/layers", kind: "http_trace_layers" },
  { key: "build_status", path: "/api/build/status", kind: "http_trace_build_status" },
] as const;
export const TRACE_PROMPT = [
  "OSA-TRACE-001. Wykonaj dwa rzeczywiste żądania HTTP GET, tylko odczyt:",
  TRACE_TARGET_ORIGIN + TRACE_TARGETS[0].path,
  TRACE_TARGET_ORIGIN + TRACE_TARGETS[1].path,
  "Pokaż rzeczywiste kody HTTP, kolejność wywołań, dowody i końcowy werdykt.",
  "Bez zmian w repozytoriach, deploymentów ani płatnych modeli.",
].join("\n");

export type TraceRequest = { task_id: string; prompt: string };
export class TraceInputError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function validateTraceInput(value: unknown): TraceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TraceInputError("BAD_TASK");
  const data = value as Record<string, unknown>;
  if (data.task_id !== TRACE_TASK || typeof data.prompt !== "string" ||
      data.prompt.trim().length < 20 || data.prompt.length > 5000)
    throw new TraceInputError("UNSUPPORTED_TASK");
  const prompt = data.prompt;
  const allowed = TRACE_TARGETS.map(x => TRACE_TARGET_ORIGIN + x.path);
  if (!allowed.every(url => prompt.includes(url))) throw new TraceInputError("MISSING_REQUIRED_ENDPOINT");
  const allUrls = prompt.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  if (allUrls.some(u => !allowed.includes(u.replace(/[.,;)]+$/, ""))))
    throw new TraceInputError("UNSUPPORTED_ENDPOINT");
  return { task_id: TRACE_TASK, prompt };
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const MAX_BYTES = 16 * 1024;
const FETCH_TIMEOUT = 8000;
interface TraceStep {
  step: number; method: "GET"; url: string; http_status: number | null;
  status: "OK" | "FAILED"; response_sha256: string | null;
  response_excerpt: string; error_code?: string;
}
export interface TraceProbeResult {
  task_id: typeof TRACE_TASK;
  task_status: "EXECUTED" | "BLOCKED";
  execution_id: string;
  run_id: string;
  proof_id: string;
  proof_verdict: RunResult["verdict"];
  provider: "NONE_DETERMINISTIC_HTTP_TOOL";
  steps: TraceStep[];
  team: TeamGraph;
  mission: Mission;
  run: RunResult;
}

async function boundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new TraceInputError("RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
function reason(error: unknown): string {
  return error instanceof TraceInputError ? error.code :
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "HTTP_TIMEOUT" : "HTTP_REQUEST_FAILED";
}
export async function runTraceProbe(
  value: unknown,
  organizationId: string,
  fetcher: typeof fetch = fetch
): Promise<TraceProbeResult> {
  const input = validateTraceInput(value);
  if (!/^[a-zA-Z0-9_:-]{3,100}$/.test(organizationId)) throw new TraceInputError("BAD_ORGANIZATION");
  const suffix = randomUUID();
  const team: TeamGraph = {
    organization_id: organizationId, project_id: "osa-proof", team_id: "osa-trace-agent",
    version: "1", agents: [{ agent_id: "http-probe", role: "read-only observer",
      executor_ref: "osa.trace.http-get.v1", tool_capabilities: ["HTTP_GET_ALLOWLIST"] }], edges: [],
  };
  const mission: Mission = {
    organization_id: organizationId, project_id: "osa-proof", team_id: team.team_id,
    team_version: team.version, mission_id: "osa-trace-"+suffix,
    objective: "OSA-TRACE-001: verify two approved HTTP endpoints via actual GET",
    entry_agent_id: "http-probe", input: { task_id: input.task_id, prompt_sha256: digest(input.prompt) },
    requirements: TRACE_TARGETS.map(target => ({
      requirement_id: "http_"+target.key+"_ok", type: "evidence_field_equals" as const,
      evidence_kind: target.kind, field: "status", expected: "OK", agent_id: "http-probe"
    }))
  };
  const executor: AgentExecutor = async () => {
    const steps: TraceStep[] = [];
    const evidence = [];
    for (const target of TRACE_TARGETS) {
      const url = TRACE_TARGET_ORIGIN + target.path;
      let step: TraceStep = {step: steps.length + 1, method: "GET", url,
        http_status: null, status: "FAILED", response_sha256: null, response_excerpt: ""};
      let content = "";
      try {
        const response = await fetcher(url, { method: "GET", redirect: "error",
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
          headers: { "accept": "application/json" } });
        step.http_status = response.status;
        content = await boundedResponse(response);
        step.response_sha256 = digest(content);
        step.response_excerpt = content.slice(0, 900);
        if (response.status !== 200) {
          step.error_code = "HTTP_"+response.status;
        } else if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
          step.error_code = "NOT_JSON";
        } else {
          let parsed: unknown;
          try { parsed = JSON.parse(content); } catch { parsed = null; }
          const valid = target.key === "layers"
            ? Array.isArray(parsed)
            : !!parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
              ["fixture","provider"].includes(String((parsed as Record<string,unknown>).mode));
          if (valid) step.status = "OK";
          else step.error_code = "UNEXPECTED_RESPONSE_SCHEMA";
        }
      } catch (error) {
        step.error_code = reason(error);
      }
      steps.push(step);
      evidence.push({kind: target.kind,
        data: {step: step.step, method: step.method, url: step.url, status: step.status,
          http_status: step.http_status, response_sha256: step.response_sha256,
          error_code: step.error_code ?? null},
        ...(content ? {content} : {})
      });
    }
    return { output: {task_id: input.task_id, steps}, evidence };
  };
  const registry = new ExecutorRegistry();
  registry.register("osa.trace.http-get.v1", executor);
  const run = await new OsaRuntime(registry).run(team, mission);
  const result = run.final_output as {steps?: TraceStep[]};
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const executed = run.verdict === "VERIFIED" &&
    steps.length === 2 && steps.every((step, i) => step.step === i+1 && step.http_status === 200 && step.status === "OK");
  return {
    task_id: TRACE_TASK, task_status: executed ? "EXECUTED" : "BLOCKED",
    execution_id: run.execution_id, run_id: run.run_id,
    proof_id: run.proof.proof_id, proof_verdict: run.verdict,
    provider: "NONE_DETERMINISTIC_HTTP_TOOL",
    steps, team, mission, run
  };
}
