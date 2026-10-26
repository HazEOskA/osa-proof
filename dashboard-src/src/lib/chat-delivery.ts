import type { Mission, Run, TeamGraph } from "../data/types";
import { canon, sha256, verifyRun } from "./verify";
export type DeliveryEvent = {event_id:string;event_type:string;timestamp:string;payload:Record<string,unknown>};
export type DeliveryProgress = {execution_id:string;mission_id:string;state:string;tasks:{agent_id:string;state:string}[];events:DeliveryEvent[]};
export interface DeliveryBundle {
  schema:string;execution_id:string;conversation_id:string;status:string;bundle_sha256:string;
  memory_status?:"VERIFIED"|"UNAVAILABLE"|"NOT_RECORDED";memory_context_sha256?:string;
  memory_write?:{document_id:string;receipt_sha256:string};memory_statement_receipt?:{document_id:string;receipt_sha256:string};
  team:TeamGraph;mission:Mission;run:Run;
  artifact:{name:string;media_type:string;content:string;sha256:string;bytes:number}|null;
  record:{timeline:DeliveryEvent[]};report:{ready_for_review:boolean;checks:{stage:string;status:string;detail:string;latency_ms:number}[]};
}
export async function verifyDelivery(bundle:DeliveryBundle) {
  if(bundle?.schema!=="osa.chat_delivery.v1" || bundle.execution_id!==bundle.run?.execution_id || bundle.run.proof.execution_id!==bundle.execution_id)throw Error("DELIVERY_BINDING_INVALID");
  const {bundle_sha256,...body}=bundle;
  if(await sha256(canon(body))!==bundle_sha256)throw Error("DELIVERY_BUNDLE_DIGEST_INVALID");
  const checks=await verifyRun(bundle.run);
  if(!checks.length||checks.some(c=>!c.ok))throw Error("DELIVERY_PROOF_INVALID");
  if(bundle.artifact){
    const a=bundle.artifact;
    const produced=(bundle.run.final_output as {artifact?:unknown})?.artifact;
    if(!["index.html","document.md"].includes(a.name)||await sha256(a.content)!==a.sha256||new TextEncoder().encode(a.content).length!==a.bytes || canon(produced)!==canon(a) ||
       !bundle.run.evidence.some(e=>e.kind==="demo_artifact"&&e.content_sha256===a.sha256))throw Error("DELIVERY_ARTIFACT_INVALID");
    if(bundle.status!=="EXECUTED"||bundle.run.verdict!=="VERIFIED"||!bundle.report.ready_for_review)throw Error("DELIVERY_VERDICT_INVALID");
  }
  return true;
}
export async function streamDelivery(payload:{prompt:string;kind:string;execution_id:string;conversation_id:string;remember?:boolean},onEvent:(type:string,data:any)=>void,signal:AbortSignal) {
  const response=await fetch("/api/chat/delivery",{method:"POST",signal,headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok){let message="HTTP "+response.status;try{message=(await response.json()).error||message;}catch{}throw Error(message);}
  if(!response.headers.get("content-type")?.includes("text/event-stream")||!response.body)throw Error("DELIVERY_STREAM_REQUIRED");
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",bytes=0,result:DeliveryBundle|undefined;
  try {while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>8*1024*1024)throw Error("DELIVERY_STREAM_TOO_LARGE");buffer+=decoder.decode(next.value,{stream:true});let end;while((end=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const type=frame.split("\n").find(l=>l.startsWith("event: "))?.slice(7);const raw=frame.split("\n").filter(l=>l.startsWith("data: ")).map(l=>l.slice(6)).join("\n");if(!type||!raw)continue;const data=JSON.parse(raw);if(data.execution_id&&data.execution_id!==payload.execution_id)throw Error("DELIVERY_STREAM_BINDING_INVALID");onEvent(type,data);if(type==="error")throw Error(data.error||data.code);if(type==="complete")result=data;}}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!result)throw Error("Połączenie przerwano bez końcowego bundle. Nie ponowiono automatycznie modelu.");
  if(result.execution_id!==payload.execution_id||result.conversation_id!==payload.conversation_id)throw Error("DELIVERY_RESPONSE_BINDING_INVALID");
  await verifyDelivery(result);return result;
}
export function downloadDelivery(name:string,content:string,type="application/json") {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const ARTIFACT_CSP="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'\">";
export function offlineReplay(bundle:DeliveryBundle) {
  const data=JSON.stringify(bundle).replace(/</g,"\\u003c");
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'"><title>OSA — replay wykonania</title><style>body{background:#080d17;color:#d6e5fa;font:15px system-ui;max-width:1000px;margin:auto;padding:24px}button,input{padding:12px;margin:6px;max-width:95%}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101c2b;padding:16px}#status{color:#7dd3fc}</style><h1>OSA · zapis przebiegu agentów</h1><p id="status">Sprawdzanie integralności…</p><p>Replay odtwarza zarejestrowane zdarzenia. Nie uruchamia modelu ani narzędzi.</p><button id="play">Odtwórz</button><input id="cursor" aria-label="Pozycja odtwarzania" type="range" min="0" value="0"><pre id="event"></pre><details><summary>Pełny bundle</summary><pre id="bundle"></pre></details><script id="data" type="application/json">${data}</script><script>
const b=JSON.parse(document.getElementById('data').textContent),events=b.record.timeline,cursor=document.getElementById('cursor');cursor.max=events.length-1;document.getElementById('bundle').textContent=JSON.stringify(b,null,2);const show=()=>{document.getElementById('event').textContent=JSON.stringify(events[Number(cursor.value)],null,2)};cursor.oninput=show;show();let timer;document.getElementById('play').onclick=()=>{clearInterval(timer);cursor.value=0;show();timer=setInterval(()=>{if(Number(cursor.value)>=events.length-1){clearInterval(timer);return}cursor.value=Number(cursor.value)+1;show()},400)};
function canon(v){if(v===null)return 'null';if(Array.isArray(v))return '['+v.map(x=>x===undefined?'null':canon(x)).join(',')+']';if(typeof v==='object')return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';return JSON.stringify(v)}async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(v=>v.toString(16).padStart(2,'0')).join('')}async function verify(){const {bundle_sha256,...body}=b;if(await hash(canon(body))!==bundle_sha256)throw Error('BUNDLE_DIGEST');const {proof_id,receipt_sha256,...receipt}=b.run.proof;if(await hash(canon(receipt))!==receipt_sha256||proof_id!=='proof_'+receipt_sha256)throw Error('PROOF_DIGEST');for(const e of b.run.evidence){const {evidence_sha256,...value}=e;if(await hash(canon(value))!==evidence_sha256)throw Error('EVIDENCE_DIGEST')}if(await hash(canon(b.run.final_output))!==b.run.proof.final_output_sha256)throw Error('OUTPUT_DIGEST');if(b.artifact&&await hash(b.artifact.content)!==b.artifact.sha256)throw Error('ARTIFACT_DIGEST');document.getElementById('status').textContent='Integralność pakietu: PASS · '+b.execution_id+' · '+events.length+' zdarzeń. Jakość treści wymaga oceny.'}verify().catch(e=>{document.getElementById('status').textContent='NIEZWERYFIKOWANO: '+e.message});</script></html>`;
}
