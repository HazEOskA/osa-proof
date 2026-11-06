import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
