import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import type { BrainPlanner, SessionRecord } from "../packages/contracts/src";
import { BrainControlPlane, NativeBrainPlanner } from "../packages/brain/src";
import { ExecutorRegistry, MissionKernel } from "../packages/runtime/src";
import { runCognitiveChat } from "../apps/api/src/chat-cognitive";
import { executeUnified, installUnifiedTools } from "../apps/api/src/unified";

const session = {identity:{organization_id:"org_p0",identity_id:"operator_p0"}} as SessionRecord;
const executionId = () => "exec_" + randomUUID();

test("P0 chat: a pinned Brain plan and APR proof exist for an actual NVIDIA completion",async()=>{
  let calls=0;
  const kernel=new MissionKernel();
  const execution_id=executionId();
  const {answer,run,record}=await runCognitiveChat({
    kernel,session,projectId:"project_p0",prompt:"Powiedz cześć",executionId:execution_id,
    complete:async()=>{calls++;return{text:"Cześć!",model:"nvidia/test",provider_response_id:"mock-provider-id",request_sha256:"a".repeat(64)};}
  });
  assert.equal(calls,1);
  assert.equal(answer.text,"Cześć!");
  assert.equal(run.execution_id,execution_id);
  assert.ok(record.brain?.planning_receipt.receipt_sha256);
  assert.equal(record.brain?.planning_receipt.verdict,"ACCEPTED");
  assert.ok(run.proof.receipt_sha256);
  assert.equal(run.final_output,"Cześć!");
  assert.equal(run.evidence.some(e=>e.kind==="chat_provider_response"),true);
});

test("P0 chat: rejected Brain plan prevents any call to NVIDIA",async()=>{
  let calls=0;
  const failing:BrainPlanner={
    id:"osa.test.rejecting-planner",mode:"native",model_refs:[],
    propose:async()=>{throw Error("POLICY_REJECTED");}
  };
  const kernel=new MissionKernel(undefined,undefined,new BrainControlPlane(failing));
  await assert.rejects(runCognitiveChat({
    kernel,session,projectId:"project_p0",prompt:"Nie omijaj planowania",executionId:executionId(),
    complete:async()=>{calls++;return{text:"never",model:"nvidia/test",provider_response_id:null,request_sha256:"b".repeat(64)};}
  }));
  assert.equal(calls,0);
});

test("P0 unified: native tool must pass configured Brain before APR",async()=>{
  let plans=0;
  const native=new NativeBrainPlanner();
  const planner:BrainPlanner={
    id:native.id,mode:native.mode,model_refs:native.model_refs,
    propose:async input=>{plans++;return native.propose(input);}
  };
  const kernel=new MissionKernel(undefined,undefined,new BrainControlPlane(planner));
  const registry=new ExecutorRegistry();
  installUnifiedTools(registry,{});
  const result=await executeUnified({
    message:"Oblicz SHA-256 tekstu: OSA Cognitive P0",execution_id:executionId()
  },"org_p0",registry,"project_p0",kernel);
  assert.equal(plans,1);
  assert.equal(result.status,"EXECUTED");
  assert.ok(result.run.proof.receipt_sha256);
  const record=await kernel.get(result.mission.mission_id);
  assert.ok(record?.brain?.planning_receipt.receipt_sha256);
});

test("P0: chat evidence contains a hash of the exact model response, without declaring its truth",async()=>{
  const {run}=await runCognitiveChat({
    kernel:new MissionKernel(),session,projectId:"project_p0",
    prompt:"Co może pójść nie tak?",executionId:executionId(),
    complete:async()=>({text:"To odpowiedź modelu, nie dowód prawdziwości.",model:"nvidia/test",provider_response_id:"test",request_sha256:"f".repeat(64)})
  });
  const evidence=run.evidence.find(e=>e.kind==="chat_provider_response");
  assert.ok(evidence);
  assert.equal(evidence.data.complete,true);
  assert.match(String(evidence.data.response_sha256),/^[a-f0-9]{64}$/);
});

test("P0 live SSE: blocked arithmetic answer remains available as raw downloadable review, with exact hash and Brain/APR receipt IDs",async()=>{
  const state=new ApiState(undefined,undefined,undefined,"open");
  const user=state.sessions.create({
    identity_id:"cognitive_p0_test",provider:"microsoft",subject:"cognitive_p0_test",
    display_name:"P0 tester",organization_id:"org_p0",project_ids:["project_chat_delivery"],
    roles:[],verified:true,
  });
  const server=createApiServer(new ExecutorRegistry(),state);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const originalFetch=globalThis.fetch, originalKey=process.env.NVIDIA_API_KEY, originalCost=process.env.OSA_ZERO_COST_ONLY;
  process.env.NVIDIA_API_KEY="test-provider-key";
  process.env.OSA_ZERO_COST_ONLY="false";
  let providerCalls=0;
  const wrong="Wynik operacyjny: 18 000 zł. Nie zwiększaj budżetu.";
  globalThis.fetch=async(url,init)=>{
    if(String(url)!=="https://integrate.api.nvidia.com/v1/chat/completions")return originalFetch(url,init);
    providerCalls++;
    return Response.json({id:"provider_response_p0",model:"nvidia/test-provider",
      choices:[{message:{content:wrong},finish_reason:"stop"}]});
  };
  try{
    const execution_id=executionId(), conversation_id=randomUUID();
    const prompt="Sklep internetowy ROAS 4,0.\nPrzychód netto: 81 000 zł\nKoszt reklam: 30 000 zł\nKoszt sprzedanych produktów: 53 000 zł\nLogistyka: 8 000 zł\nOpłaty transakcyjne: 2 000 zł";
    const response=await fetch(base+"/nvidia/fleet-live",{method:"POST",
      headers:{authorization:"Bearer "+user.token,origin:base,"content-type":"application/json"},
      body:JSON.stringify({prompt,agent:"commerce",history:[],remember:false,execution_id,conversation_id})});
    assert.equal(response.status,200,"SSE transport must establish before final verdict");
    const stream=await response.text();
    const event=(type:string)=>{
      const block=stream.split("\n\n").find(x=>x.startsWith("event: "+type+"\n"));
      assert.ok(block,"missing SSE event "+type);
      const line=block.split("\n").find(x=>x.startsWith("data: "));
      assert.ok(line);
      return JSON.parse(line.slice(6)) as Record<string,any>;
    };
    const review=event("review"), error=event("error");
    assert.equal(error.code,"COMMERCE_MODEL_RESULT_MISMATCH");
    assert.equal(review.execution_id,execution_id);
    assert.equal(review.conversation_id,conversation_id);
    assert.equal(review.raw_response,wrong);
    assert.equal(review.response_sha256,createHash("sha256").update(wrong,"utf8").digest("hex"));
    assert.match(review.planning_receipt_sha256,/^[a-f0-9]{64}$/);
    assert.match(review.proof_receipt_sha256,/^[a-f0-9]{64}$/);
    assert.equal(providerCalls,1);
    const record=await state.missionKernel.get("chat_"+execution_id.slice(5));
    assert.ok(record?.brain?.planning_receipt);
    assert.ok(record?.run?.proof);
    assert.equal(stream.includes("event: complete"),false,"blocked response must never be released as complete");
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=originalKey;
    if(originalCost===undefined)delete process.env.OSA_ZERO_COST_ONLY;else process.env.OSA_ZERO_COST_ONLY=originalCost;
  }
});
