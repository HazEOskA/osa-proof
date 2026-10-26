import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { BrainMemoryContext, EvidenceInput, MemoryWriteReceipt, MissionRecord, SessionRecord } from "../../../packages/contracts/src";
import { MemoryAccessError, MemoryService } from "./memory";
import { demoMission, demoReport, demoTeam, installDemoExecutors, type DemoRequest } from "../../../packages/demo-team/src";
import { ExecutorRegistry, MissionKernel } from "../../../packages/runtime/src";
import { digest, verifyCompletedMission } from "../../../packages/proof-core/src";
import { fleetLimit, nvidiaComplete, NvidiaError } from "./nvidia";

export type ArtifactGenerator = (request: DemoRequest) => Promise<{content: string; evidence: EvidenceInput[]}>;
type Input = { prompt: string; kind: "webapp" | "document"; execution_id: string; conversation_id: string; remember?: boolean };
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const MODEL = "openai/gpt-oss-20b";
function input(value: unknown): Input {
  const r = value as Input;
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => !["prompt","kind","execution_id","conversation_id","remember"].includes(k)) ||
      (r.remember !== undefined && typeof r.remember !== "boolean") ||
      typeof r.prompt !== "string" || !r.prompt.trim() || r.prompt.length > 4000 || !["webapp","document"].includes(r.kind) ||
      !new RegExp("^exec_" + UUID + "$", "i").test(r.execution_id) || !new RegExp("^" + UUID + "$", "i").test(r.conversation_id)) throw new NvidiaError(400,"DELIVERY_INPUT_INVALID","Podaj cel do 4000 znaków, format oraz identyfikatory rozmowy i wykonania.");
  return {...r,prompt:r.prompt.trim()};
}
export class ChatDelivery {
  // Cache is an instance-level fence, not a durable/distributed execution claim.
  private readonly attempts = new Map<string,{hash:string; status:"RUNNING"|"COMPLETED"|"FAILED"; result?:unknown; at:number}>();
  constructor(private readonly generate?: ArtifactGenerator, private readonly env: NodeJS.ProcessEnv = process.env) {}
  status() {
    return {configured:!!this.generate || !!this.env.NVIDIA_API_KEY?.trim(), enabled:!!this.generate || (!!this.env.NVIDIA_API_KEY?.trim() && this.env.OSA_NVIDIA_FREE_TIER_ACK === "true"),
      provider:"NVIDIA",model:this.env.OSA_DELIVERY_MODEL?.trim() || MODEL,model_generated:true,outputs:["webapp","document"],persistence:"DOWNLOAD_AND_BROWSER_CACHE",execution_fence:"INSTANCE_ONLY"};
  }
  async handle(req: IncomingMessage, res: ServerResponse, session: SessionRecord, kernel: MissionKernel, memory: MemoryService = new MemoryService()): Promise<void> {
    const json=(status:number,value:unknown)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(value));};
    if(req.method === "GET") return json(200,{...this.status(),memory_configured:Boolean(memory.adapter)});
    let request: Input;
    try {
      if(req.headers["sec-fetch-site"] === "cross-site") throw new NvidiaError(403,"DELIVERY_ORIGIN_DENIED","Nedozwolone pochodzenie żądania.");
      const origin=req.headers.origin;
      if(origin && !["http://"+req.headers.host,"https://"+req.headers.host].includes(origin)) throw new NvidiaError(403,"DELIVERY_ORIGIN_DENIED","Niedozwolone pochodzenie żądania.");
      if(this.env.VERCEL === "1" && !origin) throw new NvidiaError(403,"DELIVERY_ORIGIN_REQUIRED","Uruchom zadanie z czatu OSA.");
      let size=0;const chunks:Buffer[]=[];
      for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>24000)throw new NvidiaError(413,"DELIVERY_BODY_TOO_LARGE","Żądanie jest za duże.");chunks.push(Buffer.from(chunk));}
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new NvidiaError(400,"DELIVERY_INVALID_JSON","Nieprawidłowy JSON.");}
      request=input(value);
      if(!session.identity.organization_id)throw new NvidiaError(403,"DELIVERY_SCOPE_REQUIRED","Brak organizacji wykonania.");
      if(!this.status().enabled)throw new NvidiaError(503,"DELIVERY_NOT_CONFIGURED","Generowanie artefaktu wymaga modelu NVIDIA i potwierdzonego bezpłatnego dostępu na serwerze.");
      if(request.remember && !memory.adapter)throw new MemoryAccessError(503,"MEMORY_UNCONFIGURED","NeurOSA nie jest dostępna w tym środowisku. Nie zapisano wiadomości.");
      // Server scope and trusted identity are required before accepting a model request.
      if(memory.adapter)memory.scope(session,`chat_${request.conversation_id}`);
    } catch(e) {return json(e instanceof NvidiaError || e instanceof MemoryAccessError?e.status:400,
      {code:e instanceof NvidiaError || e instanceof MemoryAccessError?e.code:"DELIVERY_INVALID_INPUT",
        error:e instanceof NvidiaError || e instanceof MemoryAccessError?e.message:"Nieprawidłowe żądanie."});}
    const scope=session.identity.organization_id!;
    const key=digest([scope,session.identity.identity_id,request.execution_id]);
    const hash=digest(request);
    const previous=this.attempts.get(key);
    if(previous && previous.hash !== hash)return json(409,{code:"DELIVERY_ID_CONFLICT",error:"Ten identyfikator jest związany z innym zadaniem."});
    if(previous && previous.status !== "COMPLETED")return json(409,{code:"DELIVERY_OUTCOME_UNCONFIRMED",error:"Nie ponowiono niepewnego lub aktywnego zadania. Zachowaj identyfikator wykonania.",execution_id:request.execution_id});
    // Never evict active or recent attempts to admit additional model calls.
    for(const [k,v] of this.attempts)if(v.at<Date.now()-3600000 && v.status!=="RUNNING")this.attempts.delete(k);
    if(!previous && this.attempts.size>=100)return json(429,{code:"DELIVERY_CAPACITY",error:"Limit zadań tej instancji. Nie uruchomiono modelu."});
    if(!previous){try{fleetLimit();}catch(e){return json(429,{code:"FLEET_RATE_LIMIT",error:"Limit wywołań modelu. Spróbuj później."});}}
    const attempt=previous??{hash,status:"RUNNING" as const,at:Date.now()};
    this.attempts.set(key,attempt);
    res.writeHead(200,{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache, no-store, no-transform","x-accel-buffering":"no"});
    res.flushHeaders();
    const emit=(type:string,data:unknown)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
    if(previous){emit("complete",previous.result);res.end();return;}
    const heartbeat=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(": heartbeat\n\n");},5000);heartbeat.unref();
    try {
      let memoryContext: BrainMemoryContext | undefined;
      let remembered: MemoryWriteReceipt | undefined;
      let cursor=0;
      const observing=new MissionKernel(kernel.store,undefined,undefined,record=>{
        emit("progress",{execution_id:request.execution_id,mission_id:record.mission.mission_id,state:record.state,tasks:record.task_graph.nodes,events:record.timeline.slice(cursor)});
        cursor=record.timeline.length;
      });
      const registry=new ExecutorRegistry();
      const options={executionMode:"provider",artifactGenerator:async (spec:DemoRequest)=>{
        emit("model_started",{execution_id:request.execution_id,provider:"NVIDIA",model:this.status().model});
        try {
          // Verified source context is recovered before the model; writes require opt-in.
          if(memory.adapter) {
            if(request.remember)remembered=await memory.remember(session,request.conversation_id,request.prompt);
            memoryContext=await memory.recall(session,request.conversation_id,request.prompt);
          }
          let generated;
          if(this.generate)generated=await this.generate(spec);
          else {
            const answer=await nvidiaComplete(spec.objective,{...this.env,NVIDIA_MODEL:this.status().model,OSA_ZERO_COST_ONLY:"true"},fetch,{agent:"coding",artifact:spec.kind as "webapp"|"document",...(memoryContext?{memory:memoryContext}:{})});
            const content=answer.text.replace(/^\s*```(?:html|markdown|md)?\s*\n/i,"").replace(/\n```\s*$/,"");
            generated={content,evidence:[{kind:"model_artifact_generation",data:{provider:answer.provider,model:answer.model,request_id:answer.request_id,provider_response_id:answer.provider_response_id,request_sha256:answer.request_sha256,response_sha256:createHash("sha256").update(answer.text).digest("hex"),latency_ms:answer.latency_ms,execution_id:request.execution_id,
              ...(memoryContext?{memory_context_sha256:memoryContext.context_sha256,memory_brain_id:memoryContext.brain_id,memory_ledger_head:memoryContext.ledger_head}:{})}}]};
          }
          if(!generated.content.trim() || Buffer.byteLength(generated.content)>128*1024)throw new Error("ARTIFACT_SIZE_INVALID");
          emit("model_completed",{execution_id:request.execution_id,bytes:Buffer.byteLength(generated.content)});
          return generated;
         }catch(e){emit("model_error",{execution_id:request.execution_id,
            code:e instanceof NvidiaError || e instanceof MemoryAccessError?e.code:memory.adapter?"MEMORY_OR_MODEL_FAILED":"MODEL_GENERATION_FAILED",
            error:e instanceof NvidiaError || e instanceof MemoryAccessError?e.message:"Model lub pamięć nie dostarczyły poprawnego wyniku."});throw e;}
      }};
      installDemoExecutors(registry,options);
      const team=demoTeam({organization_id:scope,project_id:memory.adapter?memory.adapter.binding!.project_id:"project_chat_delivery"});
      const mission=demoMission({objective:request.prompt,kind:request.kind,mode:"connected",target:"artifact"},team);
      mission.mission_id="delivery_"+digest(scope).slice(0,12)+"_"+request.execution_id.slice(5);
      emit("accepted",{execution_id:request.execution_id,mission_id:mission.mission_id,roles:team.agents,model:this.status().model,conversation_id:request.conversation_id});
      await observing.create(mission,team);
      const run=await observing.execute(mission.mission_id,registry,{execution_id:request.execution_id});
      const record=(await observing.get(mission.mission_id))!;
      const report=demoReport(record);
      if(report.ready_for_review)verifyCompletedMission(record);
      let memoryWrite: MemoryWriteReceipt | undefined;
      let memoryStatus: "VERIFIED" | "UNAVAILABLE" | "NOT_RECORDED" | undefined;
      if(memory.adapter) {
        memoryStatus="NOT_RECORDED";
        if(report.ready_for_review) {
          try {
            memoryWrite=await memory.recordExecution(session,{mission,run,integrity:{ok:true},tool:"osa.chat.delivery"});
            memoryStatus="VERIFIED";
            emit("memory_verified",{execution_id:request.execution_id,receipt_sha256:memoryWrite.receipt_sha256});
          }catch {
            memoryStatus="UNAVAILABLE";
            emit("memory_error",{execution_id:request.execution_id,code:"MEMORY_WRITE_UNCONFIRMED",
              error:"Artefakt powstał, ale zapis NeurOSA nie został potwierdzony."});
          }
        }
      }
      const body={schema:"osa.chat_delivery.v1",execution_id:request.execution_id,conversation_id:request.conversation_id,status:report.ready_for_review?"EXECUTED":"FAILED",team,mission,run,record,report,artifact:report.ready_for_review?report.artifact:null,
        verification_scope:"ARTIFACT_BYTES_STRUCTURE_AND_EXECUTION_EVIDENCE",
        ...(memory.adapter?{memory_status:memoryStatus,
          ...(memoryContext?{memory_context_sha256:memoryContext.context_sha256}:{}),
          ...(remembered?{memory_statement_receipt:remembered}:{}),
          ...(memoryWrite?{memory_write:memoryWrite}:{})}:{}),limitations:["Model generated content is untrusted; factual accuracy and fitness require review.","No deployment or remote sandbox execution claimed.","Instance-only execution fence; download the bundle for durable export."]};
      const result={...body,bundle_sha256:digest(body)};
      this.attempts.set(key,{hash,status:"COMPLETED",result,at:Date.now()});
      emit("complete",result);
    } catch {
      this.attempts.set(key,{hash,status:"FAILED",at:Date.now()});
      emit("error",{code:"DELIVERY_EXECUTION_UNCONFIRMED",error:"Nie potwierdzono pełnego wykonania. Nie ponowiono automatycznie modelu.",execution_id:request.execution_id});
    } finally {clearInterval(heartbeat);res.end();}
  }
}
