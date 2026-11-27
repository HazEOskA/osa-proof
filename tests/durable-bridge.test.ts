import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDurableJobStore } from "../packages/durable-execution/src";
import { runDurableWorkerOnce } from "../apps/worker/src/durable-executor";
import { handleDurableRequest } from "../apps/api/src/durable";
import { vercelApiPath } from "../apps/api/src/vercel";
import type { SessionRecord } from "../packages/contracts/src";
import { createDurableBridge } from "../apps/worker/src/durable-bridge";
import { durableScopeDigest, forwardDurable, remoteDurableConfig } from "../apps/api/src/durable-remote";
const scope={organization_id:"org_test",identity_id:"idn_test",project_id:"project_test"};
async function listen(s:Server):Promise<string>{await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));return "http://127.0.0.1:"+(s.address() as AddressInfo).port;}
async function close(s:Server){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}
test("durable bridge: scoped authenticated admission, independent completion, recovery, idempotency, and denied access",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-durable-bridge-"));
  const token=randomUUID()+randomUUID();
  const env={OSA_DURABLE_DIR:root,OSA_DURABLE_REMOTE_URL:"https://bridge.example.test",OSA_DURABLE_REMOTE_TOKEN:token,OSA_DURABLE_REMOTE_ORGANIZATION_ID:scope.organization_id,OSA_DURABLE_REMOTE_IDENTITY_ID:scope.identity_id,OSA_DURABLE_REMOTE_PROJECT_ID:scope.project_id};
  const cfg=remoteDurableConfig(env)!;assert.ok(cfg);
  assert.equal(remoteDurableConfig({...env,OSA_DURABLE_REMOTE_URL:"http://example.test"}),undefined);
  const store=new FileDurableJobStore(root);
  const bridge=createDurableBridge(env);
  const bridgeUrl=await listen(bridge);
  // Only test transport is rewritten to loopback; production config requires HTTPS.
  const proxy=createServer((req,res)=>{req.url=vercelApiPath(req.url);void forwardDurable(req,res,scope,cfg,(url,init)=>{assert.equal(new URL(String(url)).search,"");return fetch(String(url).replace(cfg.url,bridgeUrl),init);});});
  const proxyUrl=await listen(proxy);
  try{
    assert.equal((await fetch(bridgeUrl+"/durable/status")).status,401);
    const auth={authorization:"Bearer "+token,"x-osa-durable-scope":durableScopeDigest(scope)};
    assert.equal((await fetch(bridgeUrl+"/durable/status",{headers:{...auth,"x-osa-durable-scope":"wrong"}})).status,403);
    assert.equal((await fetch(bridgeUrl+"/memory/status",{headers:auth})).status,404);
    assert.equal((await (await fetch(proxyUrl+"/durable/status")).json()).enabled,false);
    await store.workerHeartbeat();
    const status=await (await fetch(proxyUrl+"/api/osa?__osa_path=durable/status&path=durable%2Fstatus")).json();
    assert.equal(status.enabled,true);assert.equal(status.production_supported,true);
    const body={execution_id:"exec_"+randomUUID(),conversation_id:randomUUID(),kind:"model",prompt:"Test",agent:"jeverson",history:[]};
    const request={method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)};
    assert.equal((await fetch(proxyUrl+"/api/osa?__osa_path=durable/jobs&path=durable%2Fjobs",request)).status,202);
    assert.equal((await fetch(proxyUrl+"/durable/jobs",request)).status,200);
    let calls=0;
    const model=(async()=>{calls++;return {text:"TEST_BRIDGE",status:"PROVIDER_RESPONSE",model:"fixture",provider_response_id:"f",request_id:"r",request_sha256:"d",latency_ms:1,finish_reason:"stop",provider:"NVIDIA"};}) as never;
    assert.equal(await runDurableWorkerOnce(new FileDurableJobStore(root),{model}),1);
    const response=await fetch(proxyUrl+"/api/osa?__osa_path=durable/jobs/"+body.execution_id+"&path=ignored");
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,"COMPLETED");assert.equal(result.result.text,"TEST_BRIDGE");assert.equal(calls,1);
    const queued={...body,execution_id:"exec_"+randomUUID()};
    assert.equal((await fetch(proxyUrl+"/api/durable/jobs?ignored=1",{...request,body:JSON.stringify(queued)})).status,202);
    const cancelled=await fetch(proxyUrl+"/api/osa?__osa_path=durable/jobs/"+queued.execution_id+"/cancel&path=ignored",{method:"POST"});
    assert.equal(cancelled.status,200);
    assert.equal((await cancelled.json()).status,"CANCELLED");
    assert.equal((await fetch(proxyUrl+"/api/durable/unknown?route=/durable/status")).status,404);
    assert.equal((await fetch(proxyUrl+"/api/durable/jobs/not-an-id?ignored=1")).status,404);
    const denied=createServer((req,res)=>{void forwardDurable(req,res,{...scope,identity_id:"idn_other"},cfg,()=>{throw Error("MUST_NOT_FORWARD");});});
    const deniedUrl=await listen(denied);try{assert.equal((await fetch(deniedUrl+"/durable/status")).status,403);}finally{await close(denied);}
  }finally{await close(proxy);await close(bridge);await rm(root,{recursive:true,force:true});}
});

test("production gateway rejects unverified owner, wrong scope and cross-origin POST before network",async()=>{
  const env={VERCEL:"1",OSA_DURABLE_REMOTE_URL:"https://bridge.example.test",OSA_DURABLE_REMOTE_TOKEN:"t".repeat(64),OSA_DURABLE_REMOTE_ORGANIZATION_ID:"org_test",OSA_DURABLE_REMOTE_IDENTITY_ID:"idn_test",OSA_DURABLE_REMOTE_PROJECT_ID:"project_test"};
  const session:SessionRecord={session_id:"test",token:"",identity:{identity_id:"idn_test",organization_id:"org_test",project_ids:["project_test"],provider:"google",subject:"test",display_name:"Test",verified:true,roles:["owner","operator"]},created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};
  const gateway=createServer((req,res)=>{
    const identity={...session.identity,...(req.headers["x-test-visitor"]?{roles:["visitor"]}:{}),...(req.headers["x-test-unverified"]?{verified:false}:{}),...(req.headers["x-test-other"]?{identity_id:"other"}:{})};
    void handleDurableRequest(req,res,{...session,identity},"project_test",env);
  });
  const base=await listen(gateway);
  try{
    for(const header of ["x-test-visitor","x-test-unverified","x-test-other"]){
      const response=await fetch(base+"/durable/status",{headers:{[header]:"1"}});
      assert.equal(response.status,403);
    }
    const r=await fetch(base+"/durable/jobs",{method:"POST",headers:{origin:"https://evil.example","content-type":"application/json"},body:"{}"});
    assert.equal(r.status,403);assert.equal((await r.json()).code,"DURABLE_ORIGIN_DENIED");
    assert.ok(remoteDurableConfig({...env,OSA_DURABLE_REMOTE_IDENTITY_ID:" idn_test\n"}));
  }finally{await close(gateway);}
});
