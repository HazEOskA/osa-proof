import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {FileDurableJobStore,validateDurableInput,durableLocalSandboxConfigured} from "../packages/durable-execution/src";
import {runDurableWorkerOnce} from "../apps/worker/src/durable-executor";
import {verifyBuildReceipt} from "../packages/deployment/src";
import {verifyCompletedMission} from "../packages/proof-core/src";
import type {DemoOutput} from "../packages/demo-team/src";
import type {MissionRecord} from "../packages/contracts/src";
const scope={organization_id:"org_sandbox",identity_id:"identity_sandbox",project_id:"project_sandbox"};
const env={OSA_LOCAL_MODEL_PROVIDER:"ollama",OSA_MODEL_BASE_URL:"http://127.0.0.1:11434/v1",OSA_ZERO_COST_ONLY:"true"};
const input=()=>({execution_id:"exec_"+randomUUID(),conversation_id:randomUUID(),kind:"artifact",artifact_kind:"webapp",artifact_target:"sandbox",prompt:"Test lokalny"});
const content="<!doctype html><html lang=\"pl\"><head><title>Test</title></head><body><p>Za???? g??l? ja??</p></body></html>";
test("sandbox target is explicit, hashed, local-only and cannot request cloud or model mode",async()=>{
 assert.equal(validateDurableInput(input()).artifact_target,"sandbox");
 assert.throws(()=>validateDurableInput({...input(),artifact_target:"azure"}));
 assert.throws(()=>validateDurableInput({...input(),kind:"model",agent:"jeverson"}));
 assert.equal(durableLocalSandboxConfigured(env),true);
 for(const patch of [{VERCEL:"1"},{OSA_ZERO_COST_ONLY:"false"},{OSA_MODEL_BASE_URL:"https://example.com/v1"},{OSA_LOCAL_MODEL_PROVIDER:"nvidia"}])assert.equal(durableLocalSandboxConfigured({...env,...patch}),false);
 const root=await mkdtemp(join(tmpdir(),"osa-sandbox-policy-"));
 try{const store=new FileDurableJobStore(root),body=input();await store.submit(scope,body);
 await assert.rejects(store.submit(scope,{...body,artifact_target:"artifact"}),/DURABLE_ID_CONFLICT/);
 let calls=0;await runDurableWorkerOnce(store,{env:{},generate:async()=>{calls++;return {content,evidence:[]}}});
 const job=await store.get(scope,body.execution_id);assert.equal(calls,0);assert.equal(job?.status,"FAILED");assert.equal(job?.error_code,"DURABLE_SANDBOX_NOT_CONFIGURED");
 }finally{await rm(root,{recursive:true,force:true})}
});
test("LIVE Docker durable sandbox: one job, exact bytes, sealed build receipt, no model replay", {skip:process.env.OSA_LOCAL_DOCKER_TEST!=="1"},async()=>{
 const root=await mkdtemp(join(tmpdir(),"osa-durable-sandbox-"));
 try{const store=new FileDurableJobStore(root),body=input();await store.submit(scope,body);let calls=0;
 const options={env,generate:async()=>{calls++;return {content,evidence:[{kind:"controlled_test_generator",data:{fixture:true}}]}}};
 assert.equal(await runDurableWorkerOnce(store,options),1);
 const reopened=new FileDurableJobStore(root),job=await reopened.get(scope,body.execution_id);assert.equal(job?.status,"COMPLETED");
 const result=job?.result as {status:string;record:MissionRecord;artifact:{content:string};report:{ready_for_review:boolean}};
 assert.equal(result.status,"EXECUTED");assert.equal(result.report.ready_for_review,true);assert.equal(result.artifact.content,content);
 const run=result.record.run!;const receipt=(run.final_output as DemoOutput).build_receipt!;assert.ok(receipt);verifyBuildReceipt(receipt);
 assert.equal(run.evidence.filter(e=>e.kind==="build_receipt").length,1);verifyCompletedMission(result.record);
 assert.equal(await runDurableWorkerOnce(reopened,options),0);assert.equal(calls,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
