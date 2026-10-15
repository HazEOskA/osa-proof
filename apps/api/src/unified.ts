import { randomUUID, createHash } from "node:crypto";
import type { AgentExecutor, Mission, TeamGraph, RunResult } from "../../../packages/contracts/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";
import { verifyProofReceipt, bindingFor, canonicalJson } from "../../../packages/proof-core/src";

type Env = Record<string, string | undefined>;
export type UnifiedRequest = { message: string; execution_id: string };
export function unifiedInput(value: unknown): UnifiedRequest {
  const v = value as Partial<UnifiedRequest> | null;
  if (!v || typeof v.message !== "string" || v.message.trim().length < 2 || v.message.length > 20000 ||
      typeof v.execution_id !== "string" || !/^exec_[a-f0-9-]{36}$/.test(v.execution_id))
    throw new Error("UNIFIED_INVALID_INPUT");
  return { message: v.message.trim(), execution_id: v.execution_id };
}

export function selectUnifiedTool(message: string): string {
  if (/^(?:oblicz|policz|wylicz)\s+sha-?256\s+(?:tekstu\s*)?:/i.test(message)) return "osa.crypto.sha256.v1";
  if (/(?:status|zdrowie|health)\s+(?:workera|worker|hosta)/i.test(message)) return "osa.worker.health.v1";
  if (/(?:sprawdź|sprawdz|pokaż|pokaz|zbadaj|status|diagnostyka).*(?:runtime|osa proof|narzędzi|narzedzi|api)/is.test(message)) return "osa.runtime.inspect.v1";
  return "osa.unified.blocked.v1";
}

function runtimeOrigin(env: Env): string | undefined {
  const raw = env.OSA_UNIFIED_ORIGIN || (env.VERCEL_URL ? "https://" + env.VERCEL_URL : undefined);
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))))
    throw new Error("UNIFIED_ORIGIN_INVALID");
  return url.origin;
}

async function readJsonTool(url: string, executionId: string, fetcher: typeof fetch, headers: Record<string,string> = {}) {
  const r = await fetcher(url, { method:"GET", redirect:"error", signal:AbortSignal.timeout(8000),
    headers:{ accept:"application/json", "x-osa-execution-id":executionId, ...headers } });
  const reader = r.body?.getReader();
  let text = "";
  if (reader) {
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > 65536) { await reader.cancel(); throw Error("TOOL_RESPONSE_TOO_LARGE"); }
      chunks.push(next.value);
    } } finally { reader.releaseLock(); }
    text = Buffer.concat(chunks).toString("utf8");
  }
  if (r.status !== 200) throw Error("TOOL_HTTP_"+r.status);
  if (!r.headers.get("content-type")?.includes("application/json")) throw Error("TOOL_NOT_JSON");
  return { data:JSON.parse(text) as unknown, body_sha256:createHash("sha256").update(text).digest("hex"), http_status:r.status };
}

export function installUnifiedTools(registry: ExecutorRegistry, env: Env = process.env, fetcher: typeof fetch = fetch) {
  registry.register("osa.crypto.sha256.v1", async ({ mission, execution_id }) => {
    const message = String((mission.input as {message:string}).message);
    const text = message.replace(/^(?:oblicz|policz|wylicz)\s+sha-?256\s+(?:tekstu\s*)?:\s*/i, "");
    const output = { tool:"crypto.sha256", text, sha256:createHash("sha256").update(text,"utf8").digest("hex"), encoding:"utf8", execution_id };
    return { output, evidence:[{kind:"unified_tool_result",data:{status:"OK",tool:output.tool,execution_id},content:JSON.stringify(output)}] };
  });
  registry.register("osa.runtime.inspect.v1", async ({ execution_id }) => {
    const origin = runtimeOrigin(env);
    if (!origin) return blocked("RUNTIME_ORIGIN_NOT_CONFIGURED", execution_id);
    const steps = [];
    for (const path of ["/api/layers","/api/build/status"]) {
      const result = await readJsonTool(origin+path, execution_id, fetcher);
      const valid = path.endsWith("/layers") ? Array.isArray(result.data) :
        !!result.data && ["fixture","provider"].includes(String((result.data as Record<string,unknown>).mode));
      if (!valid) throw Error("TOOL_SCHEMA_INVALID");
      steps.push({path,...result});
    }
    const output = {tool:"runtime.inspect",execution_id,steps};
    return {output,evidence:[{kind:"unified_tool_result",data:{status:"OK",tool:output.tool,execution_id},content:JSON.stringify(output)}]};
  });
  registry.register("osa.worker.health.v1", async ({ execution_id }) => {
    if (!env.OSA_WORKER_BASE_URL || !env.OSA_WORKER_TOKEN) return blocked("WORKER_NOT_CONFIGURED", execution_id);
    const result = await readJsonTool(env.OSA_WORKER_BASE_URL.replace(/\/$/,"")+"/health", execution_id, fetcher,
      {authorization:"Bearer "+env.OSA_WORKER_TOKEN});
    const body = result.data as Record<string,unknown>;
    if (body?.service !== "osa-worker-host" || body.status !== "ready") throw Error("WORKER_SCHEMA_INVALID");
    const output = {tool:"worker.health",execution_id,...result};
    return {output,evidence:[{kind:"unified_tool_result",data:{status:"OK",tool:output.tool,execution_id},content:JSON.stringify(output)}]};
  });
  registry.register("osa.unified.blocked.v1", async ({execution_id}) => blocked("TOOL_NOT_AVAILABLE_IN_READ_ONLY_PREVIEW", execution_id));
}

function blocked(reason: string, execution_id: string) {
  return {output:{status:"BLOCKED",reason,execution_id},evidence:[{kind:"unified_tool_result",data:{status:"BLOCKED",reason,execution_id}}]};
}

export async function executeUnified(value: unknown, organizationId: string, registry: ExecutorRegistry) {
  const input = unifiedInput(value);
  const ref = selectUnifiedTool(input.message);
  const team: TeamGraph = {organization_id:organizationId,project_id:"osa-proof",team_id:"osa.unified.v1",version:"1",
    agents:[{agent_id:"osa-tool-worker",role:"Native OSA tool worker",executor_ref:ref,tool_capabilities:[ref]}],edges:[]};
  const mission: Mission = {organization_id:organizationId,project_id:team.project_id,team_id:team.team_id,team_version:team.version,
    mission_id:"unified_"+randomUUID(),objective:input.message,entry_agent_id:"osa-tool-worker",input:{message:input.message},
    requirements:[{requirement_id:"tool_completed",type:"evidence_field_equals",evidence_kind:"unified_tool_result",field:"status",expected:"OK",agent_id:"osa-tool-worker"}]};
  const run = await new OsaRuntime(registry,{createExecutionId:()=>input.execution_id}).run(team,mission);
  const output = run.final_output as {status?:string;reason?:string} | null;
  const status = run.verdict === "VERIFIED" ? "EXECUTED" : output?.status === "BLOCKED" ? "BLOCKED" : "FAILED";
  const integrity = verifyUnifiedBundle({team,mission,run});
  return {schema:"osa.unified.execution.v1",status,execution_id:run.execution_id,tool:ref,
    routing:"DETERMINISTIC_NATIVE_TOOL_ROUTER",provider:"NONE",team,mission,run,integrity};
}

export function verifyUnifiedBundle(value: {team:TeamGraph;mission:Mission;run:RunResult}) {
  const {team,mission,run} = value;
  const result = verifyProofReceipt({receipt:run.proof,evidence:run.evidence,observations:run.observations,final_output:run.final_output});
  const expected = bindingFor(team,mission,run.run_id,run.execution_id);
  if (canonicalJson(expected) !== canonicalJson(run.proof.binding) || run.proof.verdict !== run.verdict ||
      !run.events.every(e=>e.execution_id===run.execution_id && e.run_id===run.run_id))
    result.errors.push("execution binding mismatch");
  result.ok = result.errors.length === 0;
  return result;
}
