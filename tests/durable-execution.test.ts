import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDurableJobStore, DurableConflict } from "../packages/durable-execution/src";
import { runDurableWorkerOnce } from "../apps/worker/src/durable-executor";

const scope={organization_id:"org_read_only",identity_id:"idn_tester",project_id:"osa-proof"};
const source='<!doctype html><html lang="pl"><title>Durable</title><body><h1>Test P0</h1></body></html>';
const input=(kind:"model"|"artifact"="model")=>({
  execution_id:"exec_"+randomUUID(),conversation_id:randomUUID(),kind,
  prompt:"Odpowiedz po polsku", ...(kind==="model"?{agent:"jeverson",history:[]}:{artifact_kind:"webapp"})
});
async function withStore<T>(fn:(store:FileDurableJobStore)=>Promise<T>):Promise<T>{
  const root=await mkdtemp(join(tmpdir(),"osa-durable-"));
  try{return await fn(new FileDurableJobStore(root));}
  finally{await rm(root,{recursive:true,force:true});}
}
test("durable: accepted job survives a new store instance, idempotent replay, rejects mismatched prompt and another identity",async()=>{
  await withStore(async store=>{
    const body=input();
    const first=await store.submit(scope,body);
    assert.equal(first.created,true);assert.equal(first.job.status,"QUEUED");
    const reboot=new FileDurableJobStore(store.root);
    const duplicate=await reboot.submit(scope,body);
    assert.equal(duplicate.created,false);
    await assert.rejects(reboot.submit(scope,{...body,prompt:"Zmienione polecenie"}),(e:unknown)=>e instanceof DurableConflict&&e.code==="DURABLE_ID_CONFLICT");
    assert.equal(await reboot.get({...scope,identity_id:"idn_other"},body.execution_id),undefined);
    assert.equal((await reboot.publicStatus((await reboot.get(scope,body.execution_id))!)).status,"QUEUED");
  });
});
test("durable: independent worker completes once, result survives restart and does not call provider on polling",async()=>{
  await withStore(async store=>{
    const body=input("model");await store.submit(scope,body);
    let calls=0;
    const model=(async()=>{calls++;return {text:"WYNIK PO POWROCIE",status:"PROVIDER_RESPONSE",model:"fixture",provider_response_id:"f",request_id:"r",request_sha256:"d",latency_ms:1,finish_reason:"stop",provider:"NVIDIA"};}) as never;
    assert.equal(await runDurableWorkerOnce(store,{model}),1);
    assert.equal(await runDurableWorkerOnce(store,{model}),0);
    const job=await new FileDurableJobStore(store.root).get(scope,body.execution_id);
    assert.equal(job?.status,"COMPLETED");
    const result=job?.result as {text:string;execution_id:string};
    assert.equal(result.text,"WYNIK PO POWROCIE");
    assert.equal(result.execution_id,body.execution_id);
    assert.equal(calls,1);
  });
});
test("durable: real MissionKernel file-backed artifact seals proof and remains available to a new process",async()=>{
  await withStore(async store=>{
    const body=input("artifact");await store.submit(scope,body);
    let calls=0;
    const generate=async()=>{calls++;return {content:source,evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR"}}]};};
    assert.equal(await runDurableWorkerOnce(store,{generate}),1);
    const other=new FileDurableJobStore(store.root);
    const job=await other.get(scope,body.execution_id);
    const bundle=job?.result as {artifact:{content:string};run:{verdict:string};execution_id:string};
    assert.equal(job?.status,"COMPLETED");assert.equal(bundle.execution_id,body.execution_id);
    assert.equal(bundle.run.verdict,"VERIFIED");assert.equal(bundle.artifact.content,source);assert.equal(calls,1);
    assert.equal(await runDurableWorkerOnce(other,{generate}),0);
  });
});
test("durable: uncertain RUNNING job is not replayed, even after worker restart",async()=>{
  await withStore(async store=>{
    const body=input();await store.submit(scope,body);
    const paths=await store.queued();const claimed=await store.claim(paths[0]);
    assert.equal(claimed?.status,"RUNNING");
    let calls=0;
    assert.equal(await runDurableWorkerOnce(new FileDurableJobStore(store.root),{model:(async()=>{calls++;throw Error("MUST_NOT_RUN");}) as never}),0);
    assert.equal(calls,0);
    assert.equal((await store.get(scope,body.execution_id))?.status,"RUNNING");
    await store.finish(claimed!,"FAILED",undefined,"WORKER_TERMINATED");
    assert.equal((await store.get(scope,body.execution_id))?.error_code,"WORKER_TERMINATED");
  });
});
test("durable: rejects persistence of remember=true and hostile execution identifiers",async()=>{
  await withStore(async store=>{
    const body=input();
    await assert.rejects(store.submit(scope,{...body,remember:true}),/DURABLE_MEMORY_NOT_SUPPORTED/);
    await assert.rejects(store.submit(scope,{...body,execution_id:"../../tmp/evil"}),/DURABLE_INVALID_INPUT/);
  });
});
