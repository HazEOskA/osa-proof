import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyProofReceipt } from "../packages/proof-core/src";
import { TRACE_PROMPT, TRACE_TARGETS, TraceInputError, runTraceProbe, validateTraceInput } from "../apps/api/src/trace-probe";

const request={task_id:"OSA-TRACE-001",prompt:TRACE_PROMPT};
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const snapshot={
  layers:[{layer_id:"core",access_mode:"open"}],
  build_status:{mode:"fixture",auth_mode:"open",executor_count:2,mission_persistence:"PROCESS_MEMORY"}
};

test("OSA Trace rejects all arbitrary URLs, task changes and caller-controlled prompts",()=>{
  assert.equal(validateTraceInput(request).task_id,"OSA-TRACE-001");
  for (const bad of [
    {},{...request,task_id:"another"}, {...request,prompt:"Run arbitrary commands"},
    {...request,prompt:TRACE_PROMPT+"\nhttps://example.com"},
    {...request,prompt:TRACE_PROMPT+"\nhttp://127.0.0.1"},
    {...request,prompt:TRACE_PROMPT.replace("/layers","/private")},
  ]) assert.throws(()=>validateTraceInput(bad),TraceInputError);
});

test("authorized current-process snapshot produces two ordered evidence items and runtime proof",async()=>{
  const x=await runTraceProbe(request,"org_dev_local",snapshot);
  assert.equal(x.task_status,"EXECUTED");
  assert.equal(x.proof_verdict,"VERIFIED");
  assert.equal(x.provider,"NONE_IN_PROCESS_READ_ONLY");
  assert.equal(x.verification_scope,"IN_PROCESS_STATE_AND_RUNTIME_EVIDENCE_NOT_HTTP");
  assert.deepEqual(x.steps.map(x=>x.resource),TRACE_TARGETS.map(x=>x.path));
  assert.deepEqual(x.steps.map(x=>x.method),["LOCAL_READ","LOCAL_READ"]);
  assert.deepEqual(x.steps.map(x=>x.source),["IN_PROCESS_API_STATE","IN_PROCESS_API_STATE"]);
  assert.deepEqual(x.steps.map(x=>x.http_status),[null,null]);
  assert.deepEqual(x.steps.map(x=>x.status),["OK","OK"]);
  assert.equal(x.steps[0].response_sha256,sha(JSON.stringify(snapshot.layers)));
  assert.equal(x.steps[1].response_sha256,sha(JSON.stringify(snapshot.build_status)));
  assert.equal(x.run.execution_id,x.execution_id);
  assert.equal(x.run.proof.proof_id,x.proof_id);
  assert.equal(x.run.evidence.filter(e=>e.kind.startsWith("local_trace_")).length,2);
  assert.deepEqual(x.run.evidence.map(e=>e.data.step),[1,2]);
  assert.ok(x.run.events.some(e=>e.type==="EVIDENCE_RECORDED"));
  assert.ok(x.run.events.some(e=>e.type==="RUN_VERIFIED"));
  assert.ok(x.run.events.every(e=>e.execution_id===x.execution_id));
  assert.equal(verifyProofReceipt({receipt:x.run.proof,evidence:x.run.evidence,observations:x.run.observations,final_output:x.run.final_output}).ok,true);
});

test("invalid or absent server-owned snapshots fail closed",async()=>{
  await assert.rejects(runTraceProbe(request,"org_dev_local",null as never),TraceInputError);
  await assert.rejects(runTraceProbe(request,"org_dev_local",{} as never),TraceInputError);
  const x=await runTraceProbe(request,"org_dev_local",{layers:[],build_status:{mode:"UNKNOWN"}});
  assert.equal(x.task_status,"BLOCKED");
  assert.equal(x.proof_verdict,"FAILED");
  assert.deepEqual(x.steps.map(x=>x.status),["FAILED","FAILED"]);
  assert.deepEqual(x.steps.map(x=>x.error_code),["UNEXPECTED_STATE_SCHEMA","UNEXPECTED_STATE_SCHEMA"]);
  assert.ok(!x.run.events.some(e=>e.type==="RUN_VERIFIED"));
  assert.equal(verifyProofReceipt({receipt:x.run.proof,evidence:x.run.evidence,observations:x.run.observations,final_output:x.run.final_output}).ok,true);
});

test("unapproved task never produces a receipt",async()=>{
  await assert.rejects(runTraceProbe({...request,task_id:"RUN_SHELL"},"org_dev_local",snapshot),TraceInputError);
});

test("oversized snapshot is rejected instead of creating VERIFIED",async()=>{
  const x=await runTraceProbe(request,"org_dev_local",{
    layers:Array(400).fill({layer_id:"X".repeat(100)}),build_status:snapshot.build_status
  });
  assert.equal(x.task_status,"BLOCKED");
  assert.equal(x.proof_verdict,"FAILED");
  assert.equal(x.steps[0].error_code,"RESPONSE_TOO_LARGE");
  assert.equal(x.steps[1].status,"OK");
});

test("structurally unrelated local data never creates a VERIFIED proof",async()=>{
  const x=await runTraceProbe(request,"org_dev_local",{layers:{error:"unauthorized"},build_status:{ok:true}});
  assert.equal(x.task_status,"BLOCKED");
  assert.equal(x.proof_verdict,"FAILED");
  assert.deepEqual(x.steps.map(s=>s.error_code),["UNEXPECTED_STATE_SCHEMA","UNEXPECTED_STATE_SCHEMA"]);
  assert.equal(verifyProofReceipt({receipt:x.run.proof,evidence:x.run.evidence,
    observations:x.run.observations,final_output:x.run.final_output}).ok,true);
});
