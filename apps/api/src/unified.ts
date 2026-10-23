import { randomUUID, createHash } from "node:crypto";
import type { AgentExecutor, Mission, TeamGraph, RunResult } from "../../../packages/contracts/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";
import { verifyProofReceipt, bindingFor, canonicalJson, digest } from "../../../packages/proof-core/src";
import { RemoteWorkspaceProvider, confirmedWorkspaceCleanup } from "../../../packages/workspace-runtime/src";
import { sandboxExecutor, SandboxLifecycleError } from "../../../packages/fleet/src";
import { DurableStore, StorageError } from "./durable-store";
import type { MemoryWriteReceipt } from "../../../packages/contracts/src";

// Pozwolenie istnieje tylko podczas obsługi właściciela trwałej rezerwacji.
// Nie pochodzi z JSON klienta i nie można go odtworzyć po restarcie procesu.
export interface ExecutionPermit { readonly execution_id: string }
export interface ExecutionProgress { model?: "STARTED_UNCONFIRMED" | "COMPLETED"; memory_write?: MemoryWriteReceipt }
const permits = new WeakMap<ExecutionPermit, { scope: string; consumed: boolean; checkpoint: (progress:ExecutionProgress)=>Promise<void> }>();
export async function checkpointExecution(permit:ExecutionPermit|undefined,progress:ExecutionProgress):Promise<void>{
  if(!permit||!permits.has(permit))throw new StorageError("EXECUTION_PERMIT_DENIED",403);
  await permits.get(permit)!.checkpoint(progress);
}
export function executionErrorContext(error:unknown):Record<string,unknown>{
  if(!error||typeof error!=="object")return {};
  return {...("memory_write" in error?{memory_write:error.memory_write}:{}),...("execution_progress" in error?{execution_progress:error.execution_progress}:{}),...("execution_replay" in error?{execution_replay:error.execution_replay}:{})};
}
export type ExecutionGuard = <T>(id: string, payload: unknown, run: (permit?: ExecutionPermit) => Promise<T>,
  validate: (result: T) => boolean, requireDurable?: boolean) => Promise<T>;
const RESERVATION_PREFIX = "reservation_";
interface ExecutionReservation<T = unknown> {
  schema: "osa.execution_reservation.v1"; execution_id: string; request_sha256: string;
  state: "IN_PROGRESS" | "COMPLETED" | "FAILED"; result?: T; result_sha256?: string;
  progress?: ExecutionProgress; progress_sha256?: string;
  failure?: {code:string;status:number}; failure_sha256?:string;
}
export function isExecutionReservation(id: string, payload: unknown): boolean {
  if (!id.startsWith(RESERVATION_PREFIX)) return false;
  const p = payload as Partial<ExecutionReservation> | null;
  if (!p || p.schema !== "osa.execution_reservation.v1" || id !== RESERVATION_PREFIX + p.execution_id ||
      !/^exec_[a-f0-9-]{36}$/.test(String(p.execution_id)) || !/^[a-f0-9]{64}$/.test(String(p.request_sha256)) ||
      !["IN_PROGRESS", "COMPLETED", "FAILED"].includes(String(p.state))) throw new StorageError("EXECUTION_RESERVATION_INVALID");
  return true;
}
function validProgress(progress:ExecutionProgress|undefined,sha:string|undefined,scope:string):boolean{
  if(!progress)return sha===undefined;
  if(digest(progress)!==sha||progress.model!==undefined&&!["STARTED_UNCONFIRMED","COMPLETED"].includes(progress.model))return false;
  const r=progress.memory_write;
  return !r||(r.schema==="osa.memory_write_receipt.v1"&&r.scope?.organization_id+":"+r.scope?.project_id===scope&&
    r.receipt_sha256===digest(Object.fromEntries(Object.entries(r).filter(([k])=>k!=="receipt_sha256"))));
}
export function createExecutionGuard(store: DurableStore | undefined, scope: string, actor: unknown): ExecutionGuard {
  return async <T>(id: string, payload: unknown, run: (permit?: ExecutionPermit) => Promise<T>, validate: (result: T) => boolean, requireDurable = false): Promise<T> => {
    if (!/^exec_[a-f0-9-]{36}$/.test(id)) throw new StorageError("INVALID_EXECUTION_ID", 400);
    if (!store) {
      if (requireDurable) throw new StorageError("EXECUTION_STORAGE_REQUIRED");
      return run(); // Pozostaje wyłącznie dla istniejących lokalnych narzędzi bez modelu.
    }
    const key = RESERVATION_PREFIX + id, request_sha256 = digest({ actor, payload });
    let pending: ExecutionReservation<T> = { schema: "osa.execution_reservation.v1", execution_id: id, request_sha256, state: "IN_PROGRESS" };
    let revision: number;
    const attach=(error:unknown,progress=pending.progress)=>{
      if(error&&typeof error==="object"&&progress)Object.assign(error,{execution_progress:{model:progress.model??"NOT_STARTED"},...(progress.memory_write?{memory_write:progress.memory_write}:{})});
      return error;
    };
    try {
      const row = await store.put(scope, "executions", key, pending);
      if (row.record_id !== key || row.revision !== 1 || digest(row.payload) !== digest(pending)) throw new StorageError("EXECUTION_RESERVATION_INVALID");
      revision = row.revision;
    } catch (error) {
      if (!(error instanceof StorageError) || error.status !== 409) throw error;
      const row = await store.get<ExecutionReservation<T>>(scope, "executions", key);
      if (!row || !isExecutionReservation(key, row.payload)) throw new StorageError("EXECUTION_RESERVATION_INVALID");
      if (row.payload.request_sha256 !== request_sha256) throw new StorageError("EXECUTION_PAYLOAD_CONFLICT", 409);
      if(!validProgress(row.payload.progress,row.payload.progress_sha256,scope))throw new StorageError("EXECUTION_STORAGE_INTEGRITY_FAILED");
      if(row.payload.state==="FAILED"){
        const f=row.payload.failure;
        if(row.revision<2||!f||!/^[A-Z][A-Z0-9_]{2,100}$/.test(f.code)||!Number.isInteger(f.status)||f.status<400||f.status>599||digest(f)!==row.payload.failure_sha256)throw new StorageError("EXECUTION_STORAGE_INTEGRITY_FAILED");
        throw attach(Object.assign(new StorageError(f.code,f.status),{execution_replay:true}),row.payload.progress);
      }
      if (row.payload.state !== "COMPLETED") throw attach(new StorageError("EXECUTION_IN_PROGRESS", 409),row.payload.progress);
      if (row.revision < 2 || digest(row.payload.result)!==row.payload.result_sha256 || !validate(row.payload.result as T)) throw new StorageError("EXECUTION_STORAGE_INTEGRITY_FAILED");
      return structuredClone(row.payload.result as T);
    }
    const save=async(next:ExecutionReservation<T>)=>{
      const row=await store.put(scope,"executions",key,next,revision);
      if(row.record_id!==key||row.revision!==revision+1||digest(row.payload)!==digest(next))throw new StorageError("EXECUTION_RESERVATION_INVALID");
      revision=row.revision;
    };
    const permit: ExecutionPermit = Object.freeze({ execution_id: id });
    permits.set(permit, { scope, consumed: false, checkpoint:async progress=>{
      // Stan lokalny zachowuje potwierdzenie nawet przy utracie ACK zapisu checkpointu.
      pending={...pending,progress:{...pending.progress,...progress}};
      pending.progress_sha256=digest(pending.progress);
      await save(pending);
    }});
    try {
      if (await store.get(scope, "executions", id)) throw new StorageError("EXECUTION_LEGACY_REVIEW_REQUIRED", 409);
      const result = await run(permit);
      if (!validate(result)) throw new StorageError("EXECUTION_STORAGE_INTEGRITY_FAILED");
      await save({...pending,state:"COMPLETED",result,result_sha256:digest(result)});
      return result;
    } catch(error) {
      const e=error as {code?:unknown;status?:unknown};
      // Utrata ACK storage zostawia IN_PROGRESS: nigdy nie zgadujemy, czy zapis doszedł.
      if(!(error instanceof StorageError)&&typeof e?.code==="string"&&/^[A-Z][A-Z0-9_]{2,100}$/.test(e.code)&&
        typeof e.status==="number"&&Number.isInteger(e.status)&&e.status>=400&&e.status<=599){
        const failure={code:e.code,status:e.status};
        try{await save({...pending,state:"FAILED",failure,failure_sha256:digest(failure)});}catch{/* IN_PROGRESS blokuje powtórne wykonanie. */}
      }
      throw attach(error);
    } finally {
      permits.delete(permit);
    }
  };
}

type Env = Record<string, string | undefined>;
const tools = ["osa.crypto.sha256.v1","osa.worker.sha256.v1","osa.runtime.inspect.v1","osa.worker.health.v1","osa.conversation.record.v1"];
export type UnifiedRequest = { message: string; execution_id: string; tool?:string; args?:Record<string,unknown>; selection?:Record<string,unknown> };
export function unifiedInput(value: unknown): UnifiedRequest {
  const v = value as Partial<UnifiedRequest> | null;
  if (!v || typeof v.message !== "string" || v.message.trim().length < 2 || v.message.length > 20000 ||
      typeof v.execution_id !== "string" || !/^exec_[a-f0-9-]{36}$/.test(v.execution_id))
    throw new Error("UNIFIED_INVALID_INPUT");
  if(v.tool!==undefined && (!tools.includes(v.tool)||!v.args||typeof v.args!=="object"||Array.isArray(v.args)||!v.selection||
    !["nvidia","openrouter"].includes(String(v.selection.provider))||typeof v.selection.model!=="string"||
    !/^[a-f0-9]{64}$/.test(String(v.selection.response_sha256))))throw Error("UNIFIED_MODEL_DISPATCH_INVALID");
  if(["osa.crypto.sha256.v1","osa.worker.sha256.v1"].includes(v.tool??"") && (typeof v.args?.text!=="string"||v.args.text.length>20000||Object.keys(v.args).some(k=>k!=="text")))throw Error("UNIFIED_ARGS_INVALID");
  if(v.tool==="osa.conversation.record.v1" && (typeof v.args?.answer!=="string"||!v.args.answer.trim()||v.args.answer.length>40000))throw Error("UNIFIED_ARGS_INVALID");
  return { message: v.message.trim(), execution_id: v.execution_id, ...(v.tool?{tool:v.tool,args:v.args,selection:v.selection}:{}) };
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
  registry.register("osa.worker.sha256.v1", async context => {
    if(!env.OSA_WORKER_BASE_URL||!env.OSA_WORKER_TOKEN||env.OSA_WORKER_TOKEN.trim().length<32)
      return blocked("WORKER_NOT_CONFIGURED",context.execution_id);
    try {
      const provider=new RemoteWorkspaceProvider({baseUrl:env.OSA_WORKER_BASE_URL,token:env.OSA_WORKER_TOKEN,fetchImpl:fetcher,requestTimeoutMs:15000});
      return await sandboxExecutor(provider,async(ctx,workspace)=>{
        if(workspace.metadata?.provider!=="docker"||workspace.metadata?.network!=="none")throw Error("WORKER_ISOLATION_UNVERIFIED");
        const input=ctx.mission.input as UnifiedRequest;
        const text=input.args?.text;
        if(typeof text!=="string")throw Error("WORKER_INPUT_INVALID");
        // Stała komenda i osobny argument danych: model nie dostarcza kodu ani powłoki.
        const result=await workspace.exec("node",["-e",
          "const c=require('node:crypto');console.log(JSON.stringify({sha256:c.createHash('sha256').update(process.argv[1],'utf8').digest('hex'),uid:process.getuid()}))","--",text],{timeoutMs:10000});
        if(result.exitCode!==0||result.stdout.length>2048)throw Error("WORKER_EXECUTION_FAILED");
        const value=JSON.parse(result.stdout) as {sha256?:unknown;uid?:unknown};
        if(value.uid!==1000||value.sha256!==createHash("sha256").update(text,"utf8").digest("hex"))throw Error("WORKER_RESULT_REJECTED");
        const output={tool:"worker.sha256",text,sha256:value.sha256,encoding:"utf8",execution_id:ctx.execution_id,workspace_id:workspace.id};
        return {output,evidence:[{kind:"unified_tool_result",data:{status:"OK",tool:output.tool,execution_id:ctx.execution_id,workspace_id:workspace.id},content:JSON.stringify(output)}]};
      },30000)(context);
    } catch(error) {
      // Nie ujawniaj wyjątków transportu/sekretów i nigdy nie licz wyniku jako fallback.
      const result=blocked("WORKER_EXECUTION_UNCONFIRMED",context.execution_id);
      return error instanceof SandboxLifecycleError?{...result,evidence:[...result.evidence,{kind:"sandbox_cleanup_failure",data:error.evidence}]}:result;
    }
  });
  registry.register("osa.crypto.sha256.v1", async ({ mission, execution_id }) => {
    const message = String((mission.input as {message:string}).message);
    const args=(mission.input as UnifiedRequest).args;
    const text = typeof args?.text==="string"?args.text:message.replace(/^(?:oblicz|policz|wylicz)\s+sha-?256\s+(?:tekstu\s*)?:\s*/i, "");
    const output = { tool:"crypto.sha256", text, sha256:createHash("sha256").update(text,"utf8").digest("hex"), encoding:"utf8", execution_id };
    return { output, evidence:[{kind:"unified_tool_result",data:{status:"OK",tool:output.tool,execution_id},content:JSON.stringify(output)}] };
  });
  registry.register("osa.runtime.inspect.v1", async ({ execution_id }) => {
    const origin = runtimeOrigin(env);
    if (!origin) return blocked("RUNTIME_ORIGIN_NOT_CONFIGURED", execution_id);
    const steps = [];
    for (const path of ["/api/layers","/api/build/status"]) {
      const result = await readJsonTool(origin+path, execution_id, fetcher,env.OSA_RUNTIME_PROTECTION_BYPASS?{"x-vercel-protection-bypass":env.OSA_RUNTIME_PROTECTION_BYPASS}:{});
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
  registry.register("osa.conversation.record.v1",async({mission,execution_id})=>{
    const data=mission.input as UnifiedRequest;
    if(!data.selection||typeof data.args?.answer!=="string")return blocked("MODEL_RESPONSE_MISSING",execution_id);
    const output={tool:"conversation.record",answer:data.args.answer,execution_id};
    return {output,evidence:[{kind:"unified_tool_result",data:{status:"OK",execution_id,verification_scope:"SERVER_REPORTED_MODEL_RESPONSE_HASH"},content:JSON.stringify({output,selection:data.selection})}]};
  });
  registry.register("osa.unified.blocked.v1", async ({execution_id}) => blocked("TOOL_NOT_AVAILABLE_IN_READ_ONLY_PREVIEW", execution_id));
}

function blocked(reason: string, execution_id: string) {
  return {output:{status:"BLOCKED",reason,execution_id},evidence:[{kind:"unified_tool_result",data:{status:"BLOCKED",reason,execution_id}}]};
}

type UnifiedResult = Awaited<ReturnType<typeof runUnifiedOnce>> & { memory_write?: MemoryWriteReceipt };
export function validUnifiedResult(result: UnifiedResult): boolean {
  try { return result.execution_id === result.run.execution_id && result.run.proof.execution_id === result.execution_id &&
    verifyUnifiedBundle(result).ok && (result.status !== "EXECUTED" || result.run.verdict === "VERIFIED"); }
  catch { return false; }
}
export async function executeUnified(value: unknown, organizationId: string, registry: ExecutorRegistry, projectId = "osa-proof",
  options: { store?: DurableStore; permit?: ExecutionPermit; finish?: (result: UnifiedResult) => Promise<UnifiedResult>; actor?: unknown } = {}): Promise<UnifiedResult> {
  const input = unifiedInput(value), scope = organizationId + ":" + projectId;
  const execute = async () => {
    const result = await runUnifiedOnce(input, organizationId, registry, projectId);
    return options.finish ? options.finish(result) : result;
  };
  if (options.permit) {
    const lease = permits.get(options.permit);
    if (!lease || lease.consumed || lease.scope !== scope || options.permit.execution_id !== input.execution_id)
      throw new StorageError("EXECUTION_PERMIT_DENIED", 403);
    lease.consumed = true;
    return execute();
  }
  return createExecutionGuard(options.store, scope, options.actor ?? "server-runtime")(
    input.execution_id, { route: "unified", input }, execute,
    result=>validUnifiedResult(result)&&result.execution_id===input.execution_id&&result.team.organization_id===organizationId&&result.team.project_id===projectId,
    input.tool === "osa.worker.sha256.v1");
}

async function runUnifiedOnce(value: unknown, organizationId: string, registry: ExecutorRegistry, projectId = "osa-proof") {
  const input = unifiedInput(value);
  const ref = input.tool || selectUnifiedTool(input.message);
  // Record model dispatch provenance inside the proof's hashed evidence. This
  // proves bundle integrity, not an independent provider attestation.
  let effectiveRegistry=registry;
  if(input.selection){
    const original=registry.get(ref);
    effectiveRegistry=new ExecutorRegistry();
    effectiveRegistry.register(ref,async ctx=>{
      const result=await original(ctx);
      return {...result,evidence:[...(result.evidence||[]),{kind:"model_dispatch",data:{execution_id:input.execution_id,selection:input.selection!,arguments_sha256:digest(input.args)},content:JSON.stringify({selection:input.selection,args:input.args})}]};
    });
  }
  const team: TeamGraph = {organization_id:organizationId,project_id:projectId,team_id:"osa.unified.v1",version:"1",
    agents:[{agent_id:"osa-tool-worker",role:"Native OSA tool worker",executor_ref:ref,tool_capabilities:[ref]}],edges:[]};
  const mission: Mission = {organization_id:organizationId,project_id:team.project_id,team_id:team.team_id,team_version:team.version,
    mission_id:"unified_"+randomUUID(),objective:input.message,entry_agent_id:"osa-tool-worker",input:{...input},
    requirements:[{requirement_id:"tool_completed",type:"evidence_field_equals",evidence_kind:"unified_tool_result",field:"status",expected:"OK",agent_id:"osa-tool-worker"},
      ...(ref==="osa.worker.sha256.v1"?[{requirement_id:"sandbox_destroyed",type:"evidence_field_equals" as const,evidence_kind:"sandbox_receipt",field:"cleanup_confirmed",expected:true,agent_id:"osa-tool-worker"}]:[])]};
  const run = await new OsaRuntime(effectiveRegistry,{createExecutionId:()=>input.execution_id}).run(team,mission);
  const output = run.final_output as {status?:string;reason?:string} | null;
  const status = run.verdict === "VERIFIED" ? "EXECUTED" : output?.status === "BLOCKED" ? "BLOCKED" : "FAILED";
  const integrity = verifyUnifiedBundle({team,mission,run});
  return {schema:"osa.unified.execution.v1",status,execution_id:run.execution_id,tool:ref,
    routing:input.selection?"MODEL_TOOL_CALL":"DETERMINISTIC_NATIVE_TOOL_ROUTER",provider:input.selection?.provider||"NONE",team,mission,run,integrity};
}

export function verifyUnifiedBundle(value: {team:TeamGraph;mission:Mission;run:RunResult}) {
  const {team,mission,run} = value;
  const result = verifyProofReceipt({receipt:run.proof,evidence:run.evidence,observations:run.observations,final_output:run.final_output});
  const expected = bindingFor(team,mission,run.run_id,run.execution_id);
  if (canonicalJson(expected) !== canonicalJson(run.proof.binding) || run.proof.verdict !== run.verdict ||
      !run.events.every(e=>e.execution_id===run.execution_id && e.run_id===run.run_id))
    result.errors.push("execution binding mismatch");
  const input=mission.input as UnifiedRequest;
  if(input.selection){
    const dispatch=run.evidence.find(e=>e.kind==="model_dispatch");
    if(!dispatch||canonicalJson(dispatch.data.selection)!==canonicalJson(input.selection)||dispatch.data.arguments_sha256!==digest(input.args)||
       !team.agents.some(a=>a.executor_ref===input.tool)||dispatch.producer.executor_ref!==input.tool)
      result.errors.push("model dispatch provenance mismatch");
  }
  if(input.tool==="osa.worker.sha256.v1" && run.verdict==="VERIFIED") {
    const sandbox=run.evidence.find(e=>e.kind==="sandbox_receipt");
    if(!sandbox||sandbox.data.execution_id!==run.execution_id||sandbox.data.mission_id!==mission.mission_id||
       sandbox.data.organization_id!==team.organization_id||sandbox.data.project_id!==team.project_id||
       sandbox.data.provider!=="remote"||sandbox.data.cleanup_confirmed!==true||
       !confirmedWorkspaceCleanup(sandbox.data.cleanup,String(sandbox.data.workspace_id),{organization_id:team.organization_id,project_id:team.project_id,mission_id:mission.mission_id,task_id:sandbox.data.task_id})||
       sandbox.data.output_sha256!==digest(run.final_output)||
       canonicalJson(sandbox.data.lifecycle)!==canonicalJson(["CREATE","EXECUTE","DESTROY"])||
       sandbox.data.receipt_sha256!==digest(Object.fromEntries(Object.entries(sandbox.data).filter(([k])=>k!=="receipt_sha256"))))
      result.errors.push("sandbox execution binding mismatch");
  }
  result.ok = result.errors.length === 0;
  return result;
}
