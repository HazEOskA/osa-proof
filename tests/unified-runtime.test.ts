import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { createDevExecution } from "../apps/api/src/server";
import { ApiState, handleApiRequest } from "../apps/api/src";
import { executeUnified, installUnifiedTools, verifyUnifiedBundle, unifiedInput } from "../apps/api/src/unified";
import { createWorkerServer } from "../apps/worker/src";
import { DockerWorkspaceProvider } from "../packages/workspace-runtime/src";

const request=(message:string)=>({message,execution_id:"exec_"+randomUUID()});
test("normal tool task executes crypto, shares one ID and independently rejects tampering",async()=>{
  const x=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  const input=request("Oblicz SHA-256 tekstu: OSA Unified Runtime V1");
  const result=await executeUnified(input,"org_dev_local",x.registry);
  assert.equal(result.status,"EXECUTED");
  assert.equal((result.run.final_output as {sha256:string}).sha256,createHash("sha256").update("OSA Unified Runtime V1").digest("hex"));
  assert.ok(result.run.events.every(e=>e.execution_id===input.execution_id));
  assert.ok(result.run.evidence.every(e=>e.execution_id===input.execution_id));
  assert.equal(verifyUnifiedBundle(result).ok,true);
  const tampered=structuredClone(result);tampered.run.final_output={sha256:"invented"};
  assert.equal(verifyUnifiedBundle(tampered).ok,false);
  const swapped=structuredClone(result);swapped.run.execution_id="exec_"+randomUUID();
  assert.equal(verifyUnifiedBundle(swapped).ok,false);
  assert.ok(x.registry.refs().includes("osa.native-builder.v1"));
});

test("runtime inspection calls the actual OSA HTTP API, no fetch replacement",async()=>{
  const x=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  const state=new ApiState(undefined,undefined,undefined,"open");
  const server=createServer((req,res)=>{req.url=req.url?.replace(/^\/api/,"");void handleApiRequest(req,res,x.registry,state,{mode:"fixture"});});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const origin="http://127.0.0.1:"+(server.address() as AddressInfo).port;
    installUnifiedTools(x.registry,{OSA_UNIFIED_ORIGIN:origin});
    const result=await executeUnified(request("Sprawdź status runtime OSA Proof"),"org_dev_local",x.registry);
    assert.equal(result.status,"EXECUTED");
    const output=result.run.final_output as {steps:Array<{http_status:number;data:unknown}>};
    assert.deepEqual(output.steps.map(x=>x.http_status),[200,200]);
    assert.equal(result.integrity.ok,true);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("existing worker host returns real health; unconfigured worker and write task remain BLOCKED",async()=>{
  const token="local_test_"+randomUUID();
  const worker=createWorkerServer({token,provider:new DockerWorkspaceProvider()});
  await new Promise<void>(resolve=>worker.listen(0,"127.0.0.1",resolve));
  const x=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  try {
    installUnifiedTools(x.registry,{OSA_WORKER_BASE_URL:"http://127.0.0.1:"+(worker.address() as AddressInfo).port,OSA_WORKER_TOKEN:token});
    const health=await executeUnified(request("Pokaż status workera"),"org_dev_local",x.registry);
    assert.equal(health.status,"EXECUTED");
    assert.ok(!JSON.stringify(health).includes(token));
  } finally {await new Promise<void>(resolve=>worker.close(()=>resolve()));}
  installUnifiedTools(x.registry,{});
  for(const message of ["Pokaż status workera","OSA zbuduj aplikację i wdróż"]){
    const result=await executeUnified(request(message),"org_dev_local",x.registry);
    assert.equal(result.status,"BLOCKED");assert.notEqual(result.run.verdict,"VERIFIED");
    assert.equal(result.integrity.ok,true);
  }
  assert.throws(()=>unifiedInput({message:"test",execution_id:"wrong"}));
});

test("bounded repo inspection crosses worker HTTP and produces a verifiable execution", async () => {
  const token="local_test_"+randomUUID(), scope={organization_id:"org_dev_local",project_id:"osa-proof"};
  let requests=0;
  const worker=createWorkerServer({token,scope,readonlyRepo:"HazEOskA/osa-proof",provider:new DockerWorkspaceProvider(),
    fetchImpl:async (input, init) => {
      requests++;
      assert.equal(input,"https://api.github.com/repos/HazEOskA/osa-proof");
      assert.equal((init?.headers as Record<string,string>).authorization,undefined);
      return Response.json({full_name:"HazEOskA/osa-proof",private:false,default_branch:"main",archived:false});
    }});
  await new Promise<void>(resolve=>worker.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+(worker.address() as AddressInfo).port;
  try {
    const post=(body:unknown, auth=token)=>fetch(origin+"/v1/tools/repo-inspect",{method:"POST",headers:{authorization:"Bearer "+auth,"content-type":"application/json"},body:JSON.stringify(body)});
    const id="exec_"+randomUUID();
    assert.equal((await post({...scope,execution_id:id},"wrong")).status,401);
    assert.equal((await post({...scope,project_id:"other",execution_id:id})).status,403);
    assert.equal((await post({...scope,execution_id:id,command:"sh"})).status,400);
    assert.equal(requests,0);
    const x=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
    installUnifiedTools(x.registry,{OSA_WORKER_BASE_URL:origin,OSA_WORKER_TOKEN:token});
    const result=await executeUnified({message:"Sprawdź skonfigurowane repozytorium READ-ONLY",execution_id:id},scope.organization_id,x.registry,scope.project_id);
    assert.equal(result.status,"EXECUTED");
    assert.equal(result.tool,"osa.worker.repo.inspect.v1");
    assert.equal((result.run.final_output as {repository:string}).repository,"HazEOskA/osa-proof");
    assert.equal(result.integrity.ok,true);
    assert.equal(requests,1);
    assert.ok(!JSON.stringify(result).includes(token));
  } finally {await new Promise<void>(resolve=>worker.close(()=>resolve()));}
});
