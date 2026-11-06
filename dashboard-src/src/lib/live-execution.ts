import { downloadDelivery } from "./chat-delivery";

export type LiveState="RUNNING"|"COMPLETED"|"FAILED"|"CANCEL_REQUESTED"|"CANCEL_UNCONFIRMED";
export type LiveMode="conversation"|"artifact"|"tool";
export type LiveTraceEvent={
  schema:"osa.live_execution.v1";execution_id:string;at:string;phase:string;state:LiveState;
  source?:string;detail?:string;code?:string;model?:string;latency_ms?:number;
  request_sha256?:string;provider_response_id?:string|null;verdict?:string;bytes?:number;
};
export type LiveTrace ={
  execution_id:string;conversation_id:string;mode:LiveMode;state:LiveState;
  events:LiveTraceEvent[];tasks?:{agent_id:string;state:string}[];
};
export type ChatReview = {
  schema:"osa.chat_review.v1";
  execution_id:string;
  conversation_id?:string|null;
  raw_response:string;
  response_sha256:string;
  code:string;
  apr_verdict:string;
  mission_id?:string;
  run_id?:string;
  planning_receipt_sha256?:string|null;
  proof_receipt_sha256?:string|null;
  [key:string]:unknown;
};
/** Browser-local export; no server durability or external attestation claimed. */
export function downloadChatReview(review:ChatReview):void {
  downloadDelivery(review.execution_id+"-blocked-review.json",JSON.stringify(review,null,2),"application/json");
}
export function appendLiveEvent(current:LiveTrace, event:LiveTraceEvent):LiveTrace {
  if(event.execution_id!==current.execution_id || event.schema!=="osa.live_execution.v1")
    throw Error("LIVE_TRACE_BINDING_INVALID");
  return {...current,events:[...current.events,event].slice(-150),state:event.state};
}
export function newLiveTrace(execution_id:string,conversation_id:string,mode:LiveMode):LiveTrace {
  return {execution_id,conversation_id,mode,state:"RUNNING",events:[]};
}
export function clientTraceEvent(execution_id:string,phase:string,state:LiveState,detail:string):LiveTraceEvent {
  return {schema:"osa.live_execution.v1",execution_id,at:new Date().toISOString(),phase,state,
    source:"BROWSER",detail};
}
export function downloadLiveTrace(trace:LiveTrace) {
  downloadDelivery(trace.execution_id+"-trace.jsonl",trace.events.map(e=>JSON.stringify(e)).join("\n")+"\n","application/x-ndjson");
}
export function downloadLiveEvidence(trace:LiveTrace) {
  // Provenance metadata and time-stamped events only. Not an APR ProofReceipt.
  downloadDelivery(trace.execution_id+"-evidence.json",JSON.stringify({
    schema:"osa.live_metadata.v1",execution_id:trace.execution_id,conversation_id:trace.conversation_id,
    mode:trace.mode,state:trace.state,
    evidence_type:"OBSERVED_API_EVENTS_NO_CRYPTOGRAPHIC_ATTESTATION",
    events:trace.events.filter(e=>e.source!=="BROWSER"),
    limitations:["Browser trace is local and may be incomplete after disconnect.",
      "A request SHA and provider response ID are metadata, not proof of answer quality.",
      "Cancel signalling is per-instance and does not prove provider-side termination."]
  },null,2));
}
type LiveChatInput={prompt:string;agent:string;history:{role:"user"|"assistant";content:string}[];conversation_id:string;execution_id:string;remember:boolean};
export async function streamLiveChat(
  payload:LiveChatInput,onEvent:(type:string,data:any)=>void,signal:AbortSignal
):Promise<{text:string;status:"PROVIDER_RESPONSE";model:string;provider_model?:string;
  provider_response_id:string|null;request_id:string;latency_ms:number;
  memory_status?:string;memory?:{receipt:{document_id:string;receipt_sha256:string};remembered?:unknown}}> {
  const response=await fetch("/api/nvidia/fleet-live",{method:"POST",signal,cache:"no-store",
    headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok){
    let problem="HTTP "+response.status;
    try{const data=await response.json();problem=data.error||data.code||problem;}catch{}
    throw Error(problem);
  }
  if(!response.body||!response.headers.get("content-type")?.includes("text/event-stream"))
    throw Error("LIVE_STREAM_REQUIRED");
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let bytes=0,buffer="",answer:any;
  try{
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>1024*1024)throw Error("LIVE_TRACE_TOO_LARGE");
      buffer+=decoder.decode(chunk.value,{stream:true});
      let boundary:number;
      while((boundary=buffer.indexOf("\n\n"))>=0){
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const type=frame.split("\n").find(l=>l.startsWith("event: "))?.slice(7);
        const raw=frame.split("\n").filter(l=>l.startsWith("data: ")).map(l=>l.slice(6)).join("\n");
        if(!type||!raw)continue;
        const data=JSON.parse(raw);
        if(data.execution_id!==payload.execution_id)throw Error("LIVE_EXECUTION_BINDING_INVALID");
        if(data.conversation_id&&data.conversation_id!==payload.conversation_id)
          throw Error("LIVE_CONVERSATION_BINDING_INVALID");
        onEvent(type,data);
        if(type==="error")throw Error(data.error||data.code||"LIVE_EXECUTION_FAILED");
        if(type==="complete")answer=data;
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!answer||answer.status!=="PROVIDER_RESPONSE"||typeof answer.text!=="string"||!answer.text.trim())
    throw Error("LIVE_RESULT_UNCONFIRMED");
  return answer;
}
