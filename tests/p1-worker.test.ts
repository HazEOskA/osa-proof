// KONTRAKTY: dostawca modelu i wyniki sandboxa są FIXTURE. Tylko ostatni test
// opt-in wykonuje rzeczywisty Docker; żaden test nie korzysta z płatnego modelu.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createWorkerServer } from "../apps/worker/src";
import { DockerWorkspaceProvider, type WorkspaceProvider } from "../packages/workspace-runtime/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import { executeUnified as executeUnifiedRaw, installUnifiedTools, verifyUnifiedBundle, createExecutionGuard } from "../apps/api/src/unified";
import { nvidiaChat as nvidiaChatRaw, NvidiaError, type NvidiaChatBody, type NvidiaChatOptions } from "../apps/api/src/nvidia";
import { digest } from "../packages/proof-core/src";
import { SessionStore } from "../packages/session/src";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";

import { contractStore, fixtureCleanup } from "./p1-fix-01-fixtures";
const testStore=contractStore().store;
const nvidiaChat=(body:NvidiaChatBody,options:NvidiaChatOptions)=>nvidiaChatRaw(body,{guard:createExecutionGuard(testStore,"org_p1:osa-proof","worker-test"),...options});
const executeUnified=(value:unknown,org:string,registry:ExecutorRegistry)=>executeUnifiedRaw(value,org,registry,"osa-proof",{store:testStore});

const token="P1_SYNTHETIC_WORKER_TOKEN_1234567890123456789";
const env={NVIDIA_API_KEY:"P1_SYNTHETIC_MODEL_KEY",NVIDIA_MODEL:"nvidia/p1-contract",OSA_OPERATOR_ORGANIZATION_ID:"org_p1",OSA_OPERATOR_PROJECT_ID:"osa-proof"};
const session=new SessionStore().create({identity_id:"p1-test",provider:"server-operator",subject:"FIXTURE_SERVER_OPERATOR",display_name:"Test P1",verified:true,roles:["operator"],organization_id:"org_p1",project_ids:["osa-proof"]});
const selection={provider:"nvidia",model:env.NVIDIA_MODEL,response_sha256:"a".repeat(64)};
const text="tekst danych: $(nie_wykonuj) ; ' \" \\n";
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));return "http://127.0.0.1:"+(server.address() as AddressInfo).port;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
function input(){return {message:"Oblicz SHA-256 w sandboxie",execution_id:"exec_"+randomUUID(),tool:"osa.worker.sha256.v1",args:{text},selection};}
function fixture(options:{badResult?:boolean;network?:string;cleanupFailure?:boolean}={}){
  const observed={creates:0,commands:0,stops:0};
  const provider:WorkspaceProvider={id:"P1_CONTRACT_FIXTURE",async create(request){
    observed.creates++;
    return {id:request.workspaceId,rootDir:"/workspace",metadata:{provider:"docker",network:options.network??"none",scope:request.scope},
      async exec(command,args=[]){observed.commands++;assert.equal(command,"node");assert.equal(args[0],"-e");assert.equal(args[2],"--");assert.equal(args[3],text);
        return {exitCode:0,stdout:JSON.stringify({uid:1000,sha256:options.badResult?"f".repeat(64):sha(text)}),stderr:""};},
      async writeFile(){throw Error("FIXTURE_UNEXPECTED_FILE_WRITE");},
      async stop(){observed.stops++;if(options.cleanupFailure)throw Error("FIXTURE_CLEANUP_FAILURE");return fixtureCleanup(request.workspaceId,request.scope);}};
  }};
  return {provider,observed};
}

test("P1 FIXTURE: brak hosta blokuje wykonanie bez sieci i lokalnego fallbacku",async()=>{
  const registry=new ExecutorRegistry();let network=0;
  installUnifiedTools(registry,{},(async()=>{network++;throw Error("niedozwolona sieć");}) as typeof fetch);
  const result=await executeUnified(input(),"org_p1",registry);
  assert.equal(result.status,"BLOCKED");assert.notEqual(result.run.verdict,"VERIFIED");
  assert.equal(network,0);assert.equal(result.run.evidence.some(e=>e.kind==="sandbox_receipt"),false);
  await assert.rejects(nvidiaChat({prompt:"sandbox",execute_tools:true,execution_target:"worker",execution_id:input().execution_id},
    {env,session,dispatch:async()=>{throw Error("niedozwolony dispatch");},fetch:async()=>{network++;throw Error();}}),
    e=>e instanceof NvidiaError&&e.code==="WORKER_NOT_CONFIGURED");
  assert.equal(network,0);
});

test("P1 FIXTURE HTTP: tool definitions → modelowy kontrakt → Worker → receipt i cleanup",async()=>{
  const f=fixture(),server=createWorkerServer({token,provider:f.provider,scope:{organization_id:"org_p1",project_id:"osa-proof"}});
  const base=await listen(server),registry=new ExecutorRegistry();installUnifiedTools(registry,{OSA_WORKER_BASE_URL:base,OSA_WORKER_TOKEN:token});
  try{
    let calls=0;
    const model=(async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));
      assert.equal(body.tools.length,1);assert.equal(body.tools[0].function.name,"osa_worker_sha256");
      assert.equal(body.parallel_tool_calls,false);
      return Response.json({id:"FIXTURE_RESPONSE",model:env.NVIDIA_MODEL,choices:[{message:{content:null,tool_calls:[{id:"FIXTURE_CALL",type:"function",function:{name:"osa_worker_sha256",arguments:JSON.stringify({text})}}]}}]});
    }) as typeof fetch;
    const answer=await nvidiaChat({prompt:"Oblicz hash w sandboxie",execute_tools:true,execution_target:"worker",execution_id:input().execution_id},
      {env:{...env,OSA_WORKER_BASE_URL:base,OSA_WORKER_TOKEN:token},session,fetch:model,dispatch:(v,permit)=>executeUnifiedRaw(v,"org_p1",registry,"osa-proof",{store:testStore,permit})});
    assert.ok("bundle" in answer);const bundle=answer.bundle;
    assert.equal(answer.status,"TOOL_EXECUTED");assert.equal(calls,1);assert.equal(bundle.tool,"osa.worker.sha256.v1");
    assert.deepEqual(f.observed,{creates:1,commands:1,stops:1});assert.equal(verifyUnifiedBundle(bundle).ok,true);
    const sandbox=bundle.run.evidence.find(e=>e.kind==="sandbox_receipt")!;
    assert.equal(sandbox.data.execution_id,bundle.execution_id);assert.equal(sandbox.data.output_sha256,digest(bundle.run.final_output));
    assert.deepEqual(sandbox.data.lifecycle,["CREATE","EXECUTE","DESTROY"]);
    assert.equal(bundle.run.proof.requirement_verdicts.find(v=>v.requirement_id==="sandbox_destroyed")?.verdict,"VERIFIED");
    const tampered=structuredClone(bundle);tampered.run.evidence.find(e=>e.kind==="sandbox_receipt")!.data.execution_id="obce";
    assert.equal(verifyUnifiedBundle(tampered).ok,false);
    assert.equal((await (await fetch(base+"/health")).json()).active_workspaces,0);
    if(process.env.OSA_P1_EVIDENCE_DIR){const dir=resolve(process.env.OSA_P1_EVIDENCE_DIR);await mkdir(dir,{recursive:true});await writeFile(resolve(dir,"worker-fixture-bundle.json"),JSON.stringify(bundle,null,2));}
  }finally{await close(server);}
});

test("P1 FIXTURE: obcy scope/token, błędny wynik, sieć i cleanup nigdy nie dają PASS",async()=>{
  for(const failure of ["scope","token","result","network","cleanup"]){
    const f=fixture({badResult:failure==="result",network:failure==="network"?"bridge":"none",cleanupFailure:failure==="cleanup"});
    const server=createWorkerServer({token,provider:f.provider,scope:{organization_id:failure==="scope"?"foreign":"org_p1",project_id:"osa-proof"}});
    const base=await listen(server),registry=new ExecutorRegistry();
    installUnifiedTools(registry,{OSA_WORKER_BASE_URL:base,OSA_WORKER_TOKEN:failure==="token"?"WRONG_TOKEN_12345678901234567890123456789":token});
    try{
      const result=await executeUnified(input(),"org_p1",registry);
      assert.equal(result.status,"BLOCKED",failure);assert.notEqual(result.run.verdict,"VERIFIED",failure);
      assert.equal(result.run.evidence.some(e=>e.kind==="sandbox_receipt"),false,failure);
      if(["scope","token"].includes(failure))assert.equal(f.observed.creates,0);
      if(failure==="network")assert.equal(f.observed.commands,0);
      assert.ok(!JSON.stringify(result).includes(token));
    }finally{await close(server);}
  }
});

test("P1 FIXTURE: worker target nie przyjmuje odpowiedzi tekstowej ani innego narzędzia",async()=>{
  let dispatches=0;
  for(const reply of [{content:"Nie wykonałem narzędzia"},{content:null,tool_calls:[{id:"c",type:"function",function:{name:"osa_sha256",arguments:JSON.stringify({text})}}]}]){
    await assert.rejects(nvidiaChat({prompt:"sandbox",execute_tools:true,execution_target:"worker",execution_id:input().execution_id},
      {env:{...env,OSA_WORKER_BASE_URL:"http://127.0.0.1:1",OSA_WORKER_TOKEN:token},session,
        fetch:async()=>Response.json({id:"FIXTURE_RESPONSE",model:env.NVIDIA_MODEL,choices:[{message:reply}]}),
        dispatch:async()=>{dispatches++;throw Error();}}));
  }
  assert.equal(dispatches,0);
});

test("P1 FIXTURE: publiczny open i obcy projekt nie autoryzują sandboxa mimo skonfigurowanego hosta",async()=>{
  let network=0;
  for(const candidate of [undefined,{...session,identity:{...session.identity,provider:"local-dev" as const}},
    {...session,identity:{...session.identity,project_ids:["foreign"]}}]){
    await assert.rejects(nvidiaChat({prompt:"sandbox",execute_tools:true,execution_target:"worker",execution_id:input().execution_id},
      {env:{...env,OSA_WORKER_BASE_URL:"http://127.0.0.1:1",OSA_WORKER_TOKEN:token},session:candidate,
        fetch:async()=>{network++;throw Error();},dispatch:async()=>{throw Error();}}),
      e=>e instanceof NvidiaError&&e.code==="WORKER_ACCESS_REQUIRED");
  }
  assert.equal(network,0);
});

test("P1 LIVE Docker: nowy executor HTTP → prawdziwy sandbox → proof → usunięcie",{skip:process.env.OSA_LOCAL_DOCKER_TEST!=="1",timeout:180000},async()=>{
  const server=createWorkerServer({token,provider:new DockerWorkspaceProvider(),scope:{organization_id:"org_p1",project_id:"osa-proof"},maxWorkspaces:1});
  const base=await listen(server),registry=new ExecutorRegistry();installUnifiedTools(registry,{OSA_WORKER_BASE_URL:base,OSA_WORKER_TOKEN:token});
  try{
    const result=await executeUnified(input(),"org_p1",registry);
    assert.equal(result.status,"EXECUTED");assert.equal(verifyUnifiedBundle(result).ok,true);
    assert.equal((await (await fetch(base+"/health")).json()).active_workspaces,0);
  }finally{await close(server);}
});
