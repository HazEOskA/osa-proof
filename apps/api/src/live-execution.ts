import { createHash } from "node:crypto";
import type { SessionRecord } from "../../../packages/contracts/src";
import type { IncomingMessage, ServerResponse } from "node:http";

const EXEC_ID=/^exec_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONV_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_ACTIVE=100;
type State="RUNNING"|"CANCEL_REQUESTED"|"COMPLETED"|"FAILED"|"CANCEL_UNCONFIRMED";
export type LivePhase="accepted"|"context_started"|"context_completed"|"model_started"|"model_completed"|"evidence_started"|"evidence_completed"|"failed"|"completed"|"cancel_requested"|"cancel_unconfirmed";
type Active={controller:AbortController;conversationId:string;state:State;at:number};
export class LiveControlError extends Error {
  constructor(readonly status:number,readonly code:string) {super(code);}
}
export class LiveExecutionRegistry {
  // Instance-only control plane: distinct serverless replicas cannot confirm cancellation.
  private readonly jobs=new Map<string,Active>();
  private key(session:SessionRecord,id:string) {
    if(!session?.identity?.organization_id||!session.identity.identity_id||!EXEC_ID.test(id))
      throw new LiveControlError(400,"LIVE_SCOPE_OR_EXECUTION_ID_INVALID");
    return createHash("sha256").update(JSON.stringify([session.identity.organization_id,session.identity.identity_id,id])).digest("hex");
  }
  start(session:SessionRecord,executionId:string,conversationId:string) {
    if(!CONV_ID.test(conversationId))throw new LiveControlError(400,"LIVE_CONVERSATION_ID_INVALID");
    const key=this.key(session,executionId),now=Date.now();
    for(const [k,j] of this.jobs)if(now-j.at>3600000&&j.state!=="RUNNING"&&j.state!=="CANCEL_REQUESTED")this.jobs.delete(k);
    if(this.jobs.has(key))throw new LiveControlError(409,"LIVE_EXECUTION_ID_REUSED");
    if(this.jobs.size>=MAX_ACTIVE)throw new LiveControlError(429,"LIVE_EXECUTION_CAPACITY");
    const job:Active={controller:new AbortController(),conversationId,state:"RUNNING",at:now};
    this.jobs.set(key,job);
    return job.controller.signal;
  }
  cancel(session:SessionRecord,executionId:string,conversationId:string) {
    if(!CONV_ID.test(conversationId))throw new LiveControlError(400,"LIVE_CONVERSATION_ID_INVALID");
    const job=this.jobs.get(this.key(session,executionId));
    if(!job||job.conversationId!==conversationId)
      return {execution_id:executionId,status:"CANCEL_UNCONFIRMED" as const,
        detail:"Nie znaleziono wykonania na tej instancji serwera. Nie można potwierdzić anulowania."};
    if(job.state==="RUNNING"||job.state==="CANCEL_REQUESTED"){
      job.state="CANCEL_REQUESTED";job.controller.abort();
      return {execution_id:executionId,status:"CANCEL_REQUESTED" as const,
        detail:"Sygnał anulowania wysłany do bieżącego żądania. NVIDIA nie potwierdziła zatrzymania przetwarzania."};
    }
    return {execution_id:executionId,status:"CANCEL_UNCONFIRMED" as const,
      detail:"Wykonanie nie jest aktywne; anulowanie po stronie providera niepotwierdzone."};
  }
  requested(session:SessionRecord,executionId:string) {
    const j=this.jobs.get(this.key(session,executionId));
    return j?.state==="CANCEL_REQUESTED"||j?.controller.signal.aborted===true;
  }
  finish(session:SessionRecord,executionId:string,state:"COMPLETED"|"FAILED"|"CANCEL_UNCONFIRMED") {
    const j=this.jobs.get(this.key(session,executionId));
    if(j){j.state=j.controller.signal.aborted?"CANCEL_UNCONFIRMED":state;j.at=Date.now();}
  }
}
export function liveEvent(executionId:string,phase:LivePhase,state:"RUNNING"|"COMPLETED"|"FAILED"|"CANCEL_UNCONFIRMED",details:Record<string,unknown>={}) {
  return {schema:"osa.live_execution.v1",execution_id:executionId,phase,state,at:new Date().toISOString(),...details};
}

export async function handleLiveCancel(
  req:IncomingMessage,res:ServerResponse,session:SessionRecord,registry:LiveExecutionRegistry
) {
  const send=(status:number,body:unknown)=>{
    res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
    res.end(JSON.stringify(body));
  };
  if(req.method!=="POST")return send(405,{code:"METHOD_NOT_ALLOWED"});
  const origin=req.headers.origin;
  if(req.headers["sec-fetch-site"]==="cross-site" ||
    (origin && !["https://"+req.headers.host,"http://"+req.headers.host].includes(origin)) ||
    (process.env.VERCEL==="1"&&!origin))
    return send(403,{code:"LIVE_CANCEL_ORIGIN_DENIED"});
  let chunks:Buffer[]=[],bytes=0;
  for await(const chunk of req){
    bytes+=Buffer.byteLength(chunk);
    if(bytes>2048)return send(413,{code:"LIVE_CANCEL_TOO_LARGE"});
    chunks.push(Buffer.from(chunk));
  }
  let body:{execution_id?:unknown;conversation_id?:unknown};
  try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch{return send(400,{code:"LIVE_CANCEL_BAD_JSON"});}
  if(!body||typeof body.execution_id!=="string"||typeof body.conversation_id!=="string")
    return send(400,{code:"LIVE_CANCEL_INVALID_INPUT"});
  try{
    const answer=registry.cancel(session,body.execution_id,body.conversation_id);
    return send(answer.status==="CANCEL_REQUESTED"?202:409,answer);
  }catch(e){
    return send(e instanceof LiveControlError?e.status:500,{code:e instanceof LiveControlError?e.code:"LIVE_CANCEL_ERROR"});
  }
}
