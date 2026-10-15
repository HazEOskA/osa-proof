import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyProofReceipt } from "../packages/proof-core/src";
import { TRACE_PROMPT, TRACE_TARGETS, TRACE_TARGET_ORIGIN, TraceInputError, runTraceProbe, validateTraceInput } from "../apps/api/src/trace-probe";

const request = { task_id:"OSA-TRACE-001", prompt:TRACE_PROMPT };
const sha = (s:string)=>createHash("sha256").update(s).digest("hex");

test("OSA Trace accepts only its explicitly approved task and two HTTPS URLs",()=>{
  assert.equal(validateTraceInput(request).task_id,"OSA-TRACE-001");
  for (const bad of [
    {},{...request,task_id:"another"}, {...request,prompt:"Do arbitrary commands"},
    {...request,prompt:TRACE_PROMPT+"\nhttps://169.254.169.254/latest/meta-data"},
    {...request,prompt:TRACE_PROMPT+"\nhttps://evil.test/data"},
    {...request,prompt:TRACE_PROMPT.replace("/api/layers","/api/other")},
    {...request,prompt:TRACE_PROMPT+"\nhttp://127.0.0.1:8000"}
  ]) {
    assert.throws(()=>validateTraceInput(bad),TraceInputError);
  }
});

test("actual bounded GETs produce two ordered evidence items, native event trace and integrity-checkable proof",async()=>{
  const seen:{url:string,method:string|undefined,redirect:string|undefined}[]=[];
  const fixtures = [
    JSON.stringify([{layer_id:"core",access_mode:"open"}]),
    JSON.stringify({mode:"fixture",executors:[],persistence:"in-memory"})
  ];
  const mock: typeof fetch = async(input,init)=>{
    seen.push({url:String(input),method:init?.method,redirect:init?.redirect});
    return new Response(fixtures[seen.length-1],{status:200,headers:{"content-type":"application/json"}});
  };
  const x=await runTraceProbe(request,"org_dev_local",mock);
  assert.equal(x.task_status,"EXECUTED");
  assert.equal(x.proof_verdict,"VERIFIED");
  assert.equal(x.provider,"NONE_DETERMINISTIC_HTTP_TOOL");
  assert.deepEqual(seen.map(x=>x.url),TRACE_TARGETS.map(x=>TRACE_TARGET_ORIGIN+x.path));
  assert.deepEqual(seen.map(x=>x.method),["GET","GET"]);
  assert.deepEqual(seen.map(x=>x.redirect),["error","error"]);
  assert.equal(x.steps.length,2);
  assert.equal(x.steps[0].http_status,200);
  assert.equal(x.steps[1].http_status,200);
  assert.equal(x.steps[0].response_sha256,sha(fixtures[0]));
  assert.equal(x.steps[1].response_sha256,sha(fixtures[1]));
  assert.equal(x.run.execution_id,x.execution_id);
  assert.equal(x.run.proof.proof_id,x.proof_id);
  assert.equal(x.run.evidence.filter(e=>e.kind.startsWith("http_trace_")).length,2);
  assert.deepEqual(x.run.evidence.map(e=>e.data.step),[1,2]);
  assert.ok(x.run.events.some(e=>e.type==="EVIDENCE_RECORDED"));
  assert.ok(x.run.events.some(e=>e.type==="RUN_VERIFIED"));
  assert.ok(x.run.events.every(e=>e.execution_id===x.execution_id));
  assert.equal(verifyProofReceipt(x.run.proof).ok,true);
});

test("missing tool or blocked endpoint fails closed with truthful evidence and proof FAILED",async()=>{
  let called=0;
  const mock:typeof fetch=async()=>{
    called++;
    if (called===1) throw Error("ENETUNREACH");
    return new Response(JSON.stringify({error:"Forbidden"}),{status:403});
  };
  const x=await runTraceProbe(request,"org_dev_local",mock);
  assert.equal(called,2);
  assert.equal(x.task_status,"BLOCKED");
  assert.equal(x.proof_verdict,"FAILED");
  assert.deepEqual(x.steps.map(x=>x.status),["FAILED","FAILED"]);
  assert.deepEqual(x.steps.map(x=>x.http_status),[null,403]);
  assert.deepEqual(x.steps.map(x=>x.error_code),["HTTP_REQUEST_FAILED","HTTP_403"]);
  assert.equal(x.run.proof.requirement_verdicts.filter(x=>x.verdict==="FAILED").length,2);
  assert.ok(!x.run.events.some(e=>e.type==="RUN_VERIFIED"));
  assert.equal(verifyProofReceipt(x.run.proof).ok,true);
});

test("unapproved task never calls HTTP or produces fabricated receipt",async()=>{
  let calls=0;
  const mock:typeof fetch=async()=>{calls++;return new Response("unexpected");};
  await assert.rejects(runTraceProbe({...request,task_id:"RUN_SHELL"},"org_dev_local",mock),TraceInputError);
  assert.equal(calls,0);
});

test("oversized HTTP response cannot be accepted as proof",async()=>{
  const mock:typeof fetch=async()=>new Response("X".repeat(18*1024),{status:200});
  const x=await runTraceProbe(request,"org_dev_local",mock);
  assert.equal(x.task_status,"BLOCKED");
  assert.equal(x.proof_verdict,"FAILED");
  assert.deepEqual(x.steps.map(s=>s.error_code),["RESPONSE_TOO_LARGE","RESPONSE_TOO_LARGE"]);
  assert.equal(x.run.evidence.length,2);
});
