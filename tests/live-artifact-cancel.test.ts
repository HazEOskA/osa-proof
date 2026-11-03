import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { SessionRecord } from "../packages/contracts/src";
import { LiveExecutionRegistry,handleLiveCancel } from "../apps/api/src/live-execution";
import { ChatDelivery } from "../apps/api/src/chat-delivery";
import { MissionKernel } from "../packages/runtime/src";
import { MemoryService } from "../apps/api/src/memory";

test("artifact HTTP SSE: cancellation reaches server execution control, no fake accepted bundle",{timeout:12000},async()=>{
  const session={
    identity:{identity_id:"idn_test",organization_id:"org_test",verified:true},
    session_id:"ses_artifact_test",token:"",created_at:new Date().toISOString(),
    expires_at:new Date(Date.now()+600000).toISOString()
  } as SessionRecord;
  const registry=new LiveExecutionRegistry(),kernel=new MissionKernel(),memory=new MemoryService();
  let start=()=>{},release=()=>{};
  const started=new Promise<void>(resolve=>{start=resolve;});
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const delivery=new ChatDelivery(async request=>{
    start();
    await pending;
    return {content:"<!doctype html><html><head><title>OSA test</title></head><body><p>Cancellation fixture</p></body></html>",
      evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR",kind:request.kind}}]};
  },{});
  const server=createServer((req,res)=>{
    if(req.url==="/chat/live-cancel")return handleLiveCancel(req,res,session,registry);
    return delivery.handle(req,res,session,kernel,memory,registry);
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try{
    const a=server.address();if(!a||typeof a==="string")throw Error("NO_PORT");
    const base="http://127.0.0.1:"+a.port,execution_id="exec_"+randomUUID(),conversation_id=randomUUID();
    const stream=await fetch(base+"/chat/delivery",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({prompt:"Test kontrolowanego anulowania HTML",kind:"webapp",execution_id,conversation_id,remember:false})});
    assert.equal(stream.status,200);
    await started;
    const c=await fetch(base+"/chat/live-cancel",{method:"POST",headers:{origin:base,"content-type":"application/json"},
      body:JSON.stringify({execution_id,conversation_id})});
    assert.equal(c.status,202);
    assert.equal((await c.json()).status,"CANCEL_REQUESTED");
    release();
    const body=await stream.text();
    assert.match(body,/event: accepted/);
    assert.match(body,/"phase":"model_started"/);
    assert.match(body,/"phase":"cancel_unconfirmed"/);
    assert.match(body,/event: error/);
    assert.doesNotMatch(body,/event: complete/);
    assert.doesNotMatch(body,/"artifact":\{"name":"index.html"/);
  }finally{
    release();
    server.closeAllConnections();
    await new Promise<void>(r=>server.close(()=>r()));
  }
});
