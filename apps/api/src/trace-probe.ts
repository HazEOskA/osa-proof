import { createHash, randomUUID } from "node:crypto";
import type { AgentExecutor, Mission, TeamGraph, RunResult } from "../../../packages/contracts/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";

// Read-only, in-process diagnostics of the current deployment. No outbound HTTP,
// no other deployment, no Vercel protection bypass and no caller-controlled URL.
export const TRACE_TASK = "OSA-TRACE-001";
export const TRACE_TARGETS = [
  { key: "layers", path: "/layers", kind: "local_trace_layers" },
  { key: "build_status", path: "/build/status", kind: "local_trace_build_status" },
] as const;
export const TRACE_PROMPT = [
  "OSA-TRACE-001. Sprawdź aktualną instancję OSA Proof wyłącznie lokalnie:",
  "Odczytaj /layers i /build/status z bieżącego procesu API.",
  "Pokaż ślad wykonania, SHA-256 odczytanych danych, evidence i werdykt.",
  "To diagnostyka IN_PROCESS; nie wykonuje HTTP i nie weryfikuje zewnętrznych workerów.",
].join("\n");

export type TraceRequest = { task_id: string; prompt: string };
export type TraceSnapshot = {
  layers: unknown;
  build_status: unknown;
};
export class TraceInputError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function validateTraceInput(value: unknown): TraceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TraceInputError("BAD_TASK");
  const data = value as Record<string, unknown>;
  if (data.task_id !== TRACE_TASK || data.prompt !== TRACE_PROMPT) throw new TraceInputError("UNSUPPORTED_TASK");
  return {task_id: TRACE_TASK, prompt: TRACE_PROMPT};
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const MAX_BYTES = 16 * 1024;
interface TraceStep {
  step: number;
  method: "LOCAL_READ";
  resource: string;
  source: "IN_PROCESS_API_STATE";
  http_status: null;
  status: "OK" | "FAILED";
  response_sha256: string | null;
  response_excerpt: string;
  error_code?: string;
}
export interface TraceProbeResult {
  task_id: typeof TRACE_TASK;
  task_status: "EXECUTED" | "BLOCKED";
  execution_id: string;
  run_id: string;
  proof_id: string;
  proof_verdict: RunResult["verdict"];
  provider: "NONE_IN_PROCESS_READ_ONLY";
  verification_scope: "IN_PROCESS_STATE_AND_RUNTIME_EVIDENCE_NOT_HTTP";
  steps: TraceStep[];
  team: TeamGraph;
  mission: Mission;
  run: RunResult;
}

export async function runTraceProbe(
  value: unknown,
  organizationId: string,
  snapshot: TraceSnapshot
): Promise<TraceProbeResult> {
  const input = validateTraceInput(value);
  if (!/^[a-zA-Z0-9_:-]{3,100}$/.test(organizationId)) throw new TraceInputError("BAD_ORGANIZATION");
  // Refuse missing or malformed snapshots: no fallback to fake PASS.
  if (!snapshot || typeof snapshot !== "object" || !("layers" in snapshot) || !("build_status" in snapshot))
    throw new TraceInputError("LOCAL_SNAPSHOT_REQUIRED");
  const suffix = randomUUID();
  const team: TeamGraph = {
    organization_id: organizationId, project_id: "osa-proof", team_id: "osa-local-trace-agent",
    version: "1", agents: [{agent_id: "local-inspector", role: "read-only local inspector",
      executor_ref: "osa.trace.in-process-read.v1", tool_capabilities: ["LOCAL_STATE_READ"]}], edges: [],
  };
  const mission: Mission = {
    organization_id: organizationId, project_id: "osa-proof", team_id: team.team_id,
    team_version: team.version, mission_id: "osa-local-trace-"+suffix,
    objective: "OSA-TRACE-001: in-process, read-only inspection of the current API state",
    entry_agent_id: "local-inspector", input: {task_id: input.task_id, prompt_sha256: digest(input.prompt)},
    requirements: TRACE_TARGETS.map(target => ({
      requirement_id: "local_"+target.key+"_ok", type: "evidence_field_equals" as const,
      evidence_kind: target.kind, field: "status", expected: "OK", agent_id: "local-inspector",
    })),
  };
  const executor: AgentExecutor = async () => {
    const steps: TraceStep[] = [];
    const evidence = [];
    for (const target of TRACE_TARGETS) {
      const item = target.key === "layers" ? snapshot.layers : snapshot.build_status;
      const step: TraceStep = {step: steps.length+1, method:"LOCAL_READ",
        resource:target.path, source:"IN_PROCESS_API_STATE", http_status:null,
        status:"FAILED",response_sha256:null,response_excerpt:""};
      let content = "";
      try {
        // This is server-owned state passed after session authorization.
        content = JSON.stringify(item) ?? "";
        if(Buffer.byteLength(content,"utf8") > MAX_BYTES) {
          step.error_code = "RESPONSE_TOO_LARGE";
        } else {
          step.response_sha256 = digest(content);
          step.response_excerpt = content.slice(0,900);
          const valid = target.key === "layers"
            ? Array.isArray(item) && item.length > 0
            : !!item && typeof item === "object" && !Array.isArray(item) &&
              ["fixture","provider"].includes(String((item as Record<string,unknown>).mode));
          if (valid) step.status = "OK";
          else step.error_code = "UNEXPECTED_STATE_SCHEMA";
        }
      } catch {
        step.error_code = "LOCAL_READ_FAILED";
      }
      steps.push(step);
      evidence.push({kind:target.kind,
        data:{step:step.step,method:step.method,resource:step.resource,source:step.source,
          status:step.status,http_status:null,response_sha256:step.response_sha256,error_code:step.error_code??null},
        ...(content && step.response_sha256 ? {content} : {})
      });
    }
    return {output:{task_id:input.task_id,steps},evidence};
  };
  const registry=new ExecutorRegistry();
  registry.register("osa.trace.in-process-read.v1",executor);
  const run=await new OsaRuntime(registry).run(team,mission);
  const result=run.final_output as {steps?:TraceStep[]};
  const steps=Array.isArray(result?.steps)?result.steps:[];
  const executed=run.verdict==="VERIFIED" && steps.length===2 &&
    steps.every((step,i)=>step.step===i+1 && step.status==="OK" && step.source==="IN_PROCESS_API_STATE");
  return {task_id:TRACE_TASK,task_status:executed?"EXECUTED":"BLOCKED",
    execution_id:run.execution_id,run_id:run.run_id,proof_id:run.proof.proof_id,
    proof_verdict:run.verdict,provider:"NONE_IN_PROCESS_READ_ONLY",
    verification_scope:"IN_PROCESS_STATE_AND_RUNTIME_EVIDENCE_NOT_HTTP",
    steps,team,mission,run};
}
