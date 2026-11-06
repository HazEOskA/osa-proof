import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { SessionRecord } from "../packages/contracts/src";
import { LiveExecutionRegistry, liveEvent } from "../apps/api/src/live-execution";
import { handleLiveCancel } from "../apps/api/src/live-execution";
import { handleNvidiaRequest, nvidiaComplete, NvidiaError } from "../apps/api/src/nvidia";
import { MemoryService } from "../apps/api/src/memory";

const session=(subject:string):SessionRecord=>({
  identity:{identity_id:subject,organization_id:"org_test",verified:true} as SessionRecord["identity"],
  session_id:"ses_"+subject,token:"",created_at:new Date().toISOString(),
  expires_at:new Date(Date.now()+600000).toISOString()
} as SessionRecord);
const runId=()=> "exec_"+randomUUID();
const env={NVIDIA_API_KEY:"unit-test-key",NVIDIA_MODEL:"nvidia/test-model"};
test("live trace: tenant-scoped cancel never claims provider confirmation",()=>{
  const registry=new LiveExecutionRegistry();
  const alice=session("alice"),bob=session("bob"),id=runId(),conversation=randomUUID();
  const signal=registry.start(alice,id,conversation);
  assert.equal(signal.aborted,false);
  assert.equal(registry.cancel(bob,id,conversation).status,"CANCEL_UNCONFIRMED");
  assert.equal(signal.aborted,false);
  assert.equal(registry.cancel(alice,id,randomUUID()).status,"CANCEL_UNCONFIRMED");
  assert.equal(signal.aborted,false);
  assert.equal(registry.cancel(alice,id,conversation).status,"CANCEL_REQUESTED");
  assert.equal(signal.aborted,true);
  registry.finish(alice,id,"FAILED");
  assert.equal(registry.cancel(alice,id,conversation).status,"CANCEL_UNCONFIRMED");
  assert.throws(()=>registry.start(alice,id,conversation),/LIVE_EXECUTION_ID_REUSED/);
  assert.equal(liveEvent(id,"model_started","RUNNING").execution_id,id);
});
test("live trace: cancelled NVIDIA request cannot become a successful model response",async()=>{
  const controller=new AbortController();
  const request=nvidiaComplete("Test",env,async(_url,options)=>{
    const signal=options?.signal;
    assert.equal(signal?.aborted,false);
    return await new Promise<Response>((_resolve,reject)=>{
      signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true});
      controller.abort();
    });
  },undefined,controller.signal);
  await assert.rejects(request,(e:unknown)=>e instanceof NvidiaError&&e.code==="NVIDIA_CANCEL_UNCONFIRMED");
});
test("live HTTP E2E: accepted -> model -> APR execution proof -> content unverified -> complete",async()=>{
  const identity=session("server-a"),controller=new LiveExecutionRegistry(),conversation=randomUUID(),id=runId();
  const seen:string[]=[];
  const provider=(async(_url:unknown,init:RequestInit)=>{
    assert.equal(init.signal?.aborted,false);
    seen.push(JSON.parse(String(init.body)).messages.at(-1).content);
    return Response.json({id:"provider-live-response",choices:[{message:{content:"Analiza A i B zakończona."},finish_reason:"stop"}]});
  }) as typeof fetch;
  const server=createServer((req,res)=>handleNvidiaRequest(req,res,"/nvidia/fleet-live",new MemoryService(),identity,controller,provider,env));
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try{
    const a=server.address();if(!a||typeof a==="string")throw Error("NO_PORT");
    const response=await fetch("http://127.0.0.1:"+a.port+"/nvidia/fleet-live",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({prompt:"Przeanalizuj kampanie A i B",agent:"jeverson",history:[],conversation_id:conversation,execution_id:id,remember:false})});
    assert.equal(response.status,200);assert.match(response.headers.get("content-type")||"",/text\/event-stream/);
    const text=await response.text();
    assert.match(text,/event: accepted/);
    assert.match(text,/event: trace/);
    assert.match(text,/"phase":"model_started"/);
    assert.match(text,/"phase":"model_completed"/);
    assert.match(text,/"phase":"completed"/);
    assert.match(text,/provider-live-response/);
    assert.match(text,/Analiza A i B zakończona/);
    assert.match(text,/event: audit/);
    const rawAudit=text.split("\n\n").find(block=>block.startsWith("event: audit\n"));
    assert.ok(rawAudit,"APR audit SSE frame must be present");
    const payload=rawAudit.split("\n").find(line=>line.startsWith("data: "));
    assert.ok(payload);
    const audit=JSON.parse(payload.slice(6));
    assert.equal(audit.schema,"osa.chat_audit.v1");
    assert.equal(audit.execution_id,id);
    assert.equal(audit.final_output,"Analiza A i B zakończona.");
    assert.equal(audit.execution_verdict,"VERIFIED");
    assert.equal(audit.content_assurance.verdict,"UNVERIFIED");
    assert.match(audit.planner_receipt.receipt_sha256,/^[0-9a-f]{64}$/);
    assert.match(audit.proof.receipt_sha256,/^[0-9a-f]{64}$/);
    assert.doesNotMatch(text,/artifact\.html/);
    assert.equal(seen.length,1);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test("live HTTP E2E: server abort request is scoped and outputs CANCEL_UNCONFIRMED, never COMPLETE",{timeout:12000},async()=>{
  const identity=session("server-b"),registry=new LiveExecutionRegistry(),conversation=randomUUID(),id=runId();
  let started=()=>{};
  const waitForStart=new Promise<void>(r=>{started=r;});
  const fake=(async(_url:unknown,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
    started();
    options.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true});
  })) as typeof fetch;
  const server=createServer((req,res)=>{
    if(req.url==="/chat/live-cancel")return handleLiveCancel(req,res,identity,registry);
    return handleNvidiaRequest(req,res,"/nvidia/fleet-live",new MemoryService(),identity,registry,fake,env);
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try{
    const a=server.address();if(!a||typeof a==="string")throw Error("NO_PORT");
    const base="http://127.0.0.1:"+a.port;
    const live=fetch(base+"/nvidia/fleet-live",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({prompt:"Długi prompt",agent:"jeverson",history:[],conversation_id:conversation,execution_id:id,remember:false})});
    await Promise.race([waitForStart,new Promise<void>((_,reject)=>setTimeout(()=>reject(Error('LIVE_PROVIDER_NOT_STARTED')),4000))]);
    const cancel=await fetch(base+"/chat/live-cancel",{method:"POST",headers:{"content-type":"application/json",origin:base},
      body:JSON.stringify({execution_id:id,conversation_id:conversation})});
    assert.equal(cancel.status,202);
    assert.equal((await cancel.json()).status,"CANCEL_REQUESTED");
    const body=await (await live).text();
    assert.match(body,/"phase":"cancel_unconfirmed"/);
    assert.match(body,/event: error/);
    assert.doesNotMatch(body,/event: complete/);
    const unknown=await fetch(base+"/chat/live-cancel",{method:"POST",headers:{"content-type":"application/json",origin:base},
      body:JSON.stringify({execution_id:runId(),conversation_id:conversation})});
    assert.equal(unknown.status,409);
    assert.equal((await unknown.json()).status,"CANCEL_UNCONFIRMED");
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
