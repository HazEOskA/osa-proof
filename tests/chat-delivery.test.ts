import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { ChatDelivery, type ArtifactGenerator } from "../apps/api/src/chat-delivery";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { verifyCompletedMission } from "../packages/proof-core/src";
import type { MissionRecord } from "../packages/contracts/src";
const source='<!doctype html><html lang="pl"><title>Test kontraktu</title><body><h1>Rzeczywisty plik testu</h1></body></html>';
async function server(generate?:ArtifactGenerator,mode:"open"|"session"="open") {
  const state=new ApiState(undefined,undefined,undefined,mode);state.delivery=new ChatDelivery(generate,{});
  const http=createApiServer(createDevFixtureRegistry(),state);await new Promise<void>(r=>http.listen(0,"127.0.0.1",r));
  return {state,base:"http://127.0.0.1:"+(http.address() as AddressInfo).port,close:async()=>{http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));}};
}
const payload=()=>({prompt:"Zbuduj prostą stronę",kind:"webapp",execution_id:"exec_"+randomUUID(),conversation_id:randomUUID()});
const post=(base:string,body:unknown)=>fetch(base+"/chat/delivery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
function frames(text:string):{type:string;data:any}[]{return text.split("\n\n").filter(s=>s.startsWith("event:")).map(s=>({type:s.split("\n")[0].slice(7),data:JSON.parse(s.split("\n").find(l=>l.startsWith("data:"))!.slice(6))}));}
test("chat artifact streams real agent lifecycle before generation finishes, seals bundle, and fences repeated IDs",async()=>{
  let calls=0,release!:()=>void;const wait=new Promise<void>(r=>release=r);
  const s=await server(async()=>{calls++;await wait;return {content:source,evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR"}}]};});
  const body=payload();
  try {
    const response=await post(s.base,body);assert.equal(response.status,200);
    const reader=response.body!.getReader(),decoder=new TextDecoder();let raw="";
    while(!raw.includes("model_started")){const part=await reader.read();assert.equal(part.done,false);raw+=decoder.decode(part.value);}
    assert.match(raw,/AGENT_STARTED/);assert.equal(calls,1);assert.ok(!raw.includes('event: complete'));
    const duplicate=await post(s.base,body);assert.equal(duplicate.status,409);
    release();while(true){const part=await reader.read();if(part.done)break;raw+=decoder.decode(part.value);}
    const received=frames(raw),bundle=received.find(f=>f.type==="complete")!.data;
    assert.equal(bundle.status,"EXECUTED");assert.equal(bundle.execution_id,body.execution_id);assert.equal(bundle.artifact.content,source);
    assert.equal(bundle.artifact.sha256,createHash("sha256").update(source).digest("hex"));
    assert.equal(bundle.report.checks.length,10);verifyCompletedMission(bundle.record as MissionRecord);
    assert.ok(bundle.run.events.every((e:any)=>e.execution_id===body.execution_id));
    assert.equal(bundle.run.events.filter((e:any)=>e.type==="AGENT_STARTED").length,10);
    const again=frames(await (await post(s.base,body)).text());assert.equal(again.find(f=>f.type==="complete")!.data.bundle_sha256,bundle.bundle_sha256);assert.equal(calls,1);
    assert.equal((await post(s.base,{...body,prompt:"Inne zadanie"})).status,409);
    const proofCheck=await fetch(s.base+"/unified/verify",{method:"POST",body:JSON.stringify(bundle)});
    assert.equal(proofCheck.status,200);assert.equal((await proofCheck.json() as {ok:boolean}).ok,true);
  }finally{release();await s.close();}
});
test("failed model output never substitutes starter or becomes deliverable; authentication and free tier gate are enforced",async()=>{
  const s=await server(async()=>{throw Error("provider-secret-never-export");});
  try {const raw=await (await post(s.base,payload())).text();assert.ok(!raw.includes("provider-secret"));const b=frames(raw).find(f=>f.type==="complete")!.data;assert.equal(b.status,"FAILED");assert.equal(b.artifact,null);assert.equal(b.report.ready_for_review,false);assert.notEqual(b.run.verdict,"VERIFIED");}
  finally{await s.close();}
  const gated=await server();try{assert.equal((await post(gated.base,payload())).status,503);}finally{await gated.close();}
  const secure=await server(undefined,"session");try{assert.equal((await post(secure.base,payload())).status,401);assert.equal((await fetch(secure.base+"/chat/delivery/status")).status,401);}finally{await secure.close();}
});
test("artifact request rejects invalid identities, client authority and cross-origin before generator",async()=>{
  let calls=0;const s=await server(async()=>{calls++;return {content:source,evidence:[]};});
  try{
    for(const extra of [{execution_id:"exec_bad"},{kind:"azure"},{apiKey:"forged"},{conversation_id:"invalid"}])assert.equal((await post(s.base,{...payload(),...extra})).status,400);
    const cross=await fetch(s.base+"/chat/delivery",{method:"POST",headers:{origin:"https://foreign.invalid"},body:JSON.stringify(payload())});assert.equal(cross.status,403);assert.equal(calls,0);
  }finally{await s.close();}
});
