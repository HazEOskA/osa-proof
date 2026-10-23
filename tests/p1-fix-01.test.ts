import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { ApiState, handleApiRequest } from "../apps/api/src";
import { BrainControlPlane } from "../packages/brain/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import { executeUnified, installUnifiedTools, createExecutionGuard, validUnifiedResult } from "../apps/api/src/unified";
import { StorageError } from "../apps/api/src/durable-store";
import { contractMemory, contractStore, fixtureCleanup } from "./p1-fix-01-fixtures";

const identity={identity_id:"fix-test",provider:"microsoft" as const,subject:"FIXTURE_TRUSTED_FIX",display_name:"P1 FIX",verified:true,roles:[],organization_id:"org_fix",project_ids:["osa-proof"]};
const env={NVIDIA_API_KEY:"P1_FIX_SYNTHETIC_MODEL_KEY"};
function ensureContractStorage(state:ApiState){if(!state.durable)Object.defineProperty(state,"durable",{value:contractStore().store});return state;}

async function request(state:ApiState,registry:ExecutorRegistry,token:string,path:string,payload?:unknown){
  if(payload&&typeof payload==="object"&&["/nvidia/chat","/nvidia/fleet-chat","/models/chat"].includes(path)&&!("execution_id" in payload))payload={...payload,execution_id:"exec_"+randomUUID()};
  const req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]) as any;
  Object.assign(req,{url:path,method:payload===undefined?"GET":"POST",headers:{authorization:"Bearer "+token}});
  let status=0,body:any;const res={setHeader(){},writeHead(value:number){status=value;},end(value:string){body=JSON.parse(value);}} as any;
  await handleApiRequest(req,res,registry,state);return {status,body};
}
function worker(registry:ExecutorRegistry,options:{cleanupFailure?:boolean;wait?:Promise<void>}={}){
  const counts={creates:0,executes:0,cleanup:0};
  const fetcher=(async(url,init)=>{
    if(init?.method==="DELETE"){counts.cleanup++;return options.cleanupFailure?new Response("",{status:503}):Response.json({ok:true,removed:true,cleanup:fixtureCleanup(JSON.parse(String(init?.body)).workspaceId,JSON.parse(String(init?.body)).scope)});}
    const body=JSON.parse(String(init?.body));
    if(String(url).endsWith("/exec")){
      counts.executes++;if(options.wait)await options.wait;
      return Response.json({exitCode:0,stdout:JSON.stringify({uid:1000,sha256:createHash("sha256").update(body.args[3]).digest("hex")}),stderr:""});
    }
    counts.creates++;return Response.json({workspace:{id:body.workspaceId,rootDir:"/workspace",metadata:{provider:"docker",network:"none",scope:body.scope}}});
  }) as typeof fetch;
  installUnifiedTools(registry,{OSA_WORKER_BASE_URL:"https://p1-fix-worker.invalid",OSA_WORKER_TOKEN:"P1_FIX_SYNTHETIC_WORKER_TOKEN_123456789"},fetcher);
  return counts;
}
const input=()=>({message:"P1 FIX kontrakt sandboxa",execution_id:"exec_"+randomUUID(),tool:"osa.worker.sha256.v1",args:{text:"P1 FIX"},selection:{provider:"nvidia",model:"fixture",response_sha256:"a".repeat(64)}});
const code=(expected:string)=>(e:unknown)=>e instanceof StorageError&&e.code===expected;

test("P1 FIX: atomowa rezerwacja, równoległy retry, replay, konflikt payloadu i brak podwójnego sandboxa",async()=>{
  const storage=contractStore(),registry=new ExecutorRegistry();let release!:()=>void;
  const wait=new Promise<void>(r=>release=r),counts=worker(registry,{wait}),body=input();
  const first=executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store});
  while(!counts.executes)await new Promise(r=>setTimeout(r,1));
  await assert.rejects(executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store}),code("EXECUTION_IN_PROGRESS"));
  await assert.rejects(executeUnified({...body,args:{text:"inna treść"}},"org_fix",registry,"osa-proof",{store:storage.store}),code("EXECUTION_PAYLOAD_CONFLICT"));
  release();const done=await first;
  assert.equal(done.status,"EXECUTED");assert.equal(validUnifiedResult(done),true);
  assert.deepEqual(await executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store}),JSON.parse(JSON.stringify(done)));
  assert.deepEqual(counts,{creates:1,executes:1,cleanup:1});
  assert.equal([...storage.records.values()].filter(r=>(r.payload as any).state==="COMPLETED").length,1);
  console.info("P1_FIX_01_PROOF "+JSON.stringify({case:"atomic-retry",mode:"FIXTURE",execution_id:body.execution_id,counts,receipt:done.run.proof.receipt_sha256,parallel:"EXECUTION_IN_PROGRESS",conflict:"EXECUTION_PAYLOAD_CONFLICT",replay:"SAME_RECEIPT"}));
});

test("P1 FIX: niepotwierdzony zapis zakończenia i uszkodzony zapis nigdy nie ponawiają sandboxa",async()=>{
  const storage=contractStore(),registry=new ExecutorRegistry(),counts=worker(registry),body=input();
  storage.setRejectCompletion(true);
  await assert.rejects(executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store}),code("STORAGE_REQUEST_REJECTED"));
  storage.setRejectCompletion(false);
  await assert.rejects(executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store}),code("EXECUTION_IN_PROGRESS"));
  assert.deepEqual(counts,{creates:1,executes:1,cleanup:1});
  const next=input();await executeUnified(next,"org_fix",registry,"osa-proof",{store:storage.store});
  const row=[...storage.records.values()].find(r=>r.record_id==="reservation_"+next.execution_id)!;
  (row.payload as any).result.run.proof.receipt_sha256="f".repeat(64);
  await assert.rejects(executeUnified(next,"org_fix",registry,"osa-proof",{store:storage.store}),code("EXECUTION_STORAGE_INTEGRITY_FAILED"));
  assert.deepEqual(counts,{creates:2,executes:2,cleanup:2});
});

test("P1 FIX: brak storage, awaria rezerwacji i obce pozwolenie nie wykonują sandboxa",async()=>{
  const storage=contractStore(),registry=new ExecutorRegistry(),counts=worker(registry),body=input();
  await assert.rejects(executeUnified(body,"org_fix",registry),code("EXECUTION_STORAGE_REQUIRED"));
  storage.setUnavailable(true);
  await assert.rejects(executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store}),code("STORAGE_REQUEST_REJECTED"));
  await assert.rejects(executeUnified(body,"org_fix",registry,"osa-proof",{permit:{execution_id:body.execution_id}}),code("EXECUTION_PERMIT_DENIED"));
  assert.deepEqual(counts,{creates:0,executes:0,cleanup:0});
});

test("P1 FIX: błąd cleanupu pozostaje BLOCKED także przy retry",async()=>{
  const storage=contractStore(),registry=new ExecutorRegistry(),counts=worker(registry,{cleanupFailure:true}),body=input();
  const first=await executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store});
  assert.equal(first.status,"BLOCKED");assert.notEqual(first.run.verdict,"VERIFIED");
  assert.equal(first.run.evidence.some(e=>e.kind==="sandbox_receipt"),false);
  assert.deepEqual(await executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store}),JSON.parse(JSON.stringify(first)));
  assert.deepEqual(counts,{creates:1,executes:1,cleanup:1});
});

test("P1 FIX: restart procesu odtwarza COMPLETED i blokuje osierocony IN_PROGRESS z trwałej testowej SQLite",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"osa-p1-fix-restart-")),file=join(directory,"contract.sqlite");
  try{
    const storage=contractStore(file),registry=new ExecutorRegistry(),counts=worker(registry),body=input();
    const done=await executeUnified(body,"org_fix",registry,"osa-proof",{store:storage.store});
    const orphan=input();
    await assert.rejects(createExecutionGuard(storage.store,"org_fix:osa-proof","server-runtime")(orphan.execution_id,{route:"unified",input:orphan},async()=>{throw Error("FIXTURE_CRASH")},()=>false),/FIXTURE_CRASH/);
    const script=`const {contractStore}=require('./dist/tests/p1-fix-01-fixtures');const {ExecutorRegistry}=require('./dist/packages/runtime/src');const {executeUnified}=require('./dist/apps/api/src/unified');
      (async()=>{const store=contractStore(process.argv[1]).store;const input=JSON.parse(process.argv[2]);const registry=new ExecutorRegistry();
      registry.register('osa.worker.sha256.v1',()=>{throw Error('NIE_WOLNO_PONAWIAC');});
      try{const result=await executeUnified(input,'org_fix',registry,'osa-proof',{store});console.log(JSON.stringify({state:'COMPLETED',receipt:result.run.proof.receipt_sha256}));}
      catch(e){console.log(JSON.stringify({code:e.code}));}})().catch(()=>process.exit(1));`;
    for(const [payload,expected] of [[body,{state:"COMPLETED",receipt:done.run.proof.receipt_sha256}],[orphan,{code:"EXECUTION_IN_PROGRESS"}]] as const){
      const child=spawnSync(process.execPath,["-e",script,file,JSON.stringify(payload)],{encoding:"utf8",env:{PATH:process.env.PATH}});
      assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),expected);
    }
    assert.deepEqual(counts,{creates:1,executes:1,cleanup:1});
    console.info("P1_FIX_01_PROOF "+JSON.stringify({case:"process-restart",storage:"TEMPORARY_SQLITE_CONTRACT",execution_id:body.execution_id,receipt:done.run.proof.receipt_sha256,completed:"RESTORED_IN_NEW_PROCESS",in_progress:"BLOCKED_IN_NEW_PROCESS",counts}));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("P1 FIX: dwa niezależne procesy konkurują o jeden execution_id w trwałym magazynie kontraktowym",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"osa-p1-fix-race-")),file=join(directory,"race.sqlite"),id="exec_"+randomUUID();
  try{
    const script=`const {contractStore}=require('./dist/tests/p1-fix-01-fixtures');const {createExecutionGuard}=require('./dist/apps/api/src/unified');
      (async()=>{try{const r=await createExecutionGuard(contractStore(process.argv[1]).store,'org_fix:osa-proof','same-actor')(process.argv[2],{task:'same-payload'},async()=>{console.log('EXECUTOR_STARTED');await new Promise(r=>setTimeout(r,200));return {state:'fixture-result'};},r=>r.state==='fixture-result');console.log(JSON.stringify(r));}
      catch(e){console.log(JSON.stringify({code:e.code}));}})().catch(()=>process.exit(1));`;
    const run=()=>new Promise<string>((resolve,reject)=>{
      const child=spawn(process.execPath,["-e",script,file,id],{env:{PATH:process.env.PATH}});let stdout="",stderr="";
      child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);child.on("error",reject);
      child.on("close",code=>code===0?resolve(stdout):reject(Error(stderr)));
    });
    const outputs=await Promise.all([run(),run()]);
    assert.equal(outputs.join("").split("EXECUTOR_STARTED").length-1,1);
    const states=outputs.map(s=>JSON.parse(s.trim().split("\n").at(-1)!));
    assert.ok(states.some(s=>s.state==="fixture-result"));assert.ok(states.every(s=>s.state==="fixture-result"||s.code==="EXECUTION_IN_PROGRESS"));
    console.info("P1_FIX_01_PROOF "+JSON.stringify({case:"cross-process-CAS",mode:"TEMPORARY_SQLITE_CONTRACT",execution_id:id,executor_starts:1,states}));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test("P1 FIX: obie trasy NVIDIA zachowują pamięć, starszy klient ma stabilny zakres, awaria blokuje model",async()=>{
  const original=globalThis.fetch,memory=contractMemory();let calls=0;const sent:any[]=[];
  globalThis.fetch=async(_url,init)=>{calls++;sent.push(JSON.parse(String(init?.body)));return Response.json({id:"FIXTURE_RESPONSE",model:"fixture",choices:[{message:{content:"syntetyczna odpowiedź"}}]});};
  const config={...env,NVIDIA_API_KEY:"FIX_MEMORY_"+randomUUID()};
  const state=new ApiState(undefined,undefined,undefined,"session",undefined,new BrainControlPlane(undefined,memory.adapter),undefined,config),session=ensureContractStorage(state).sessions.create(identity),registry=new ExecutorRegistry();
  try{
    const ids:string[]=[];
    for(const path of ["/nvidia/fleet-chat","/models/chat"]){
      config.NVIDIA_API_KEY="FIX_MEMORY_"+randomUUID();
      for(let attempt=0;attempt<2;attempt++){
        const result=await request(state,registry,session.token,path,{provider:"nvidia",prompt:"kontynuuj rozmowę",agent:"jeff",history:[]});
        assert.equal(result.status,200);assert.equal(result.body.status,"PROVIDER_RESPONSE");ids.push(result.body.memory.context.scope.mission_id);
        assert.equal(result.body.memory.context.scope.organization_id,"org_fix");assert.equal(result.body.memory.context.scope.project_id,"osa-proof");
      }
    }
    assert.equal(new Set(ids).size,1);assert.equal(memory.documents.size,4);
    assert.ok(sent.every(r=>r.messages.some((m:any)=>m.content.includes("syntetyczny kontekst P1 FIX"))));
    memory.setAvailable(false);const before=calls;
    for(const path of ["/nvidia/fleet-chat","/models/chat"]){
      const result=await request(state,registry,session.token,path,{provider:"nvidia",prompt:"nie wykonuj modelu",conversation_id:randomUUID()});
      assert.equal(result.status,502);assert.equal(result.body.code,"MEMORY_OPERATION_FAILED");
    }
    assert.equal(calls,before);
    const denied=state.sessions.create({...identity,project_ids:["foreign"]});
    const beforeMemory=memory.requests;
    assert.equal((await request(state,registry,denied.token,"/models/chat",{provider:"nvidia",prompt:"obcy projekt"})).status,403);
    assert.equal(memory.requests,beforeMemory);assert.equal(calls,before);
    memory.setAvailable(true);memory.setWrites(false);
    for(const path of ["/nvidia/fleet-chat","/models/chat"]){
      const result=await request(state,registry,session.token,path,{provider:"nvidia",prompt:"odrzucony remember",remember:true,conversation_id:randomUUID()});
      assert.equal(result.status,502);assert.equal(calls,before);
    }
    console.info("P1_FIX_01_PROOF "+JSON.stringify({case:"memory-routes",routes:["/nvidia/fleet-chat","/models/chat"],mode:"FIXTURE",stable_legacy_scope:ids[0],authorized_model_calls:calls,model_calls_when_memory_down:0,model_calls_when_remember_rejected:0}));
  }finally{globalThis.fetch=original;}
});

test("P1 FIX: retry HTTP obu tras odtwarza wynik bez ponownego modelu ani narzędzia",async()=>{
  const storage=contractStore(),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url)===storage.env.OSA_STORAGE_URL)return storage.fetch(url,init);
    calls++;return Response.json({id:"FIXTURE_RESPONSE_"+calls,model:"fixture",choices:[{message:{content:null,tool_calls:[{id:"call_"+calls,type:"function",function:{name:"osa_sha256",arguments:'{"text":"FIX"}'}}]}}]});
  };
  try{
    for(const path of ["/nvidia/fleet-chat","/models/chat"]){
      const config={...env,...storage.env,NVIDIA_API_KEY:"FIX_REPLAY_"+randomUUID()};
      const makeState=()=>new ApiState(undefined,undefined,undefined,"session",undefined,undefined,undefined,config);
      const state=makeState(),session=ensureContractStorage(state).sessions.create(identity),registry=new ExecutorRegistry();
      const body={provider:"nvidia",prompt:"Oblicz hash",agent:"jeff",conversation_id:randomUUID(),execute_tools:true,execution_id:"exec_"+randomUUID()};
      const first=await request(state,registry,session.token,path,body);assert.equal(first.status,200);assert.equal(first.body.status,"TOOL_EXECUTED");
      const before=calls,restarted=makeState(),newSession=restarted.sessions.create(identity);
      const replay=await request(restarted,new ExecutorRegistry(),newSession.token,path,body);
      assert.equal(replay.status,200);assert.deepEqual(replay.body,first.body);assert.equal(calls,before);
      const conflict=await request(restarted,new ExecutorRegistry(),newSession.token,path,{...body,prompt:"zmieniony prompt"});
      assert.equal(conflict.status,409);assert.equal(conflict.body.code,"EXECUTION_PAYLOAD_CONFLICT");assert.equal(calls,before);
      await restarted.restoreExecutions("org_fix","osa-proof");assert.ok(restarted.runs.size>0);
    }
  }finally{globalThis.fetch=original;}
});

test("P1 FIX: provider inny niż NVIDIA używa obowiązkowej pamięci, bez pamięci zachowuje kontrakt",async()=>{
  const memory=contractMemory(),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));assert.ok(body.messages.some((m:any)=>m.content.includes("syntetyczny kontekst")));
    return Response.json({id:"FIXTURE_ROUTER",model:"fixture",choices:[{finish_reason:"stop",message:{content:"odpowiedź routera"}}],usage:{prompt_tokens:1,completion_tokens:1}});
  };
  const config={OPENROUTER_API_KEY:"FIX_ROUTER_"+randomUUID(),OPENROUTER_MODEL:"openrouter/free"};
  const state=new ApiState(undefined,undefined,undefined,"session",undefined,new BrainControlPlane(undefined,memory.adapter),undefined,config),session=ensureContractStorage(state).sessions.create(identity),registry=new ExecutorRegistry();
  try{
    const body={provider:"openrouter",prompt:"kontynuuj",conversation_id:randomUUID()};
    const success=await request(state,registry,session.token,"/models/chat",body);assert.equal(success.status,200);assert.ok(success.body.memory.receipt.receipt_sha256);
    memory.setAvailable(false);
    assert.equal((await request(state,registry,session.token,"/models/chat",{...body,execution_id:"exec_"+randomUUID()})).status,502);assert.equal(calls,1);
    globalThis.fetch=async()=>{calls++;return Response.json({id:"FIXTURE_ROUTER",model:"fixture",choices:[{finish_reason:"stop",message:{content:"bez pamięci"}}],usage:{prompt_tokens:1,completion_tokens:1}});};
    const legacy=new ApiState(undefined,undefined,undefined,"session",undefined,undefined,undefined,config),legacySession=ensureContractStorage(legacy).sessions.create(identity);
    assert.equal((await request(legacy,registry,legacySession.token,"/models/chat",{provider:"openrouter",prompt:"starszy klient"})).status,200);assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});

test("P1 FIX: równoległe żądania obu tras API → jeden model, sandbox, cleanup i zapis NeurOSA",async()=>{
  const original=globalThis.fetch;
  try{
    for(const path of ["/nvidia/fleet-chat","/models/chat"]){
      const storage=contractStore(),memory=contractMemory(),counts={model:0,create:0,execute:0,cleanup:0};let release!:()=>void,started!:()=>void;
      const wait=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
      const config={...storage.env,NVIDIA_API_KEY:"FIX_PARALLEL_"+randomUUID(),OSA_OPERATOR_ORGANIZATION_ID:"org_fix",OSA_OPERATOR_PROJECT_ID:"osa-proof",OSA_WORKER_BASE_URL:"https://p1-fix-worker.invalid",OSA_WORKER_TOKEN:"P1_FIX_SYNTHETIC_WORKER_TOKEN_123456789"};
      globalThis.fetch=async(url,init)=>{
        if(String(url)===storage.env.OSA_STORAGE_URL)return storage.fetch(url,init);
        if(String(url)==="https://integrate.api.nvidia.com/v1/chat/completions"){
          counts.model++;started();await wait;
          return Response.json({id:"FIXTURE_MODEL",model:"fixture",choices:[{message:{content:null,tool_calls:[{id:"call",type:"function",function:{name:"osa_worker_sha256",arguments:'{"text":"FIX"}'}}]}}]});
        }
        assert.ok(String(url).startsWith(config.OSA_WORKER_BASE_URL));
        if(init?.method==="DELETE"){counts.cleanup++;return Response.json({ok:true,removed:true,cleanup:fixtureCleanup(JSON.parse(String(init?.body)).workspaceId,JSON.parse(String(init?.body)).scope)});}
        const body=JSON.parse(String(init?.body));
        if(String(url).endsWith("/exec")){counts.execute++;return Response.json({exitCode:0,stdout:JSON.stringify({uid:1000,sha256:createHash("sha256").update(body.args[3]).digest("hex")}),stderr:""});}
        counts.create++;return Response.json({workspace:{id:body.workspaceId,rootDir:"/workspace",metadata:{provider:"docker",network:"none",scope:body.scope}}});
      };
      const makeState=()=>new ApiState(undefined,undefined,undefined,"session",undefined,new BrainControlPlane(undefined,memory.adapter),undefined,config);
      const a=makeState(),b=makeState(),operator={...identity,provider:"server-operator" as const,roles:["operator"]};
      const sa=a.sessions.create(operator),sb=b.sessions.create(operator);
      const body={provider:"nvidia",prompt:"sandbox",remember:true,conversation_id:randomUUID(),execute_tools:true,execution_target:"worker",execution_id:"exec_"+randomUUID()};
      const first=request(a,new ExecutorRegistry(),sa.token,path,body);
      await Promise.race([ready,first.then(()=>{throw Error("MODEL_DID_NOT_START");})]);
      try{
        const simultaneous=await request(b,new ExecutorRegistry(),sb.token,path,body);
        assert.equal(simultaneous.status,409);assert.equal(simultaneous.body.code,"EXECUTION_IN_PROGRESS");
      }finally{release();}
      const done=await first;assert.equal(done.status,200);assert.equal(done.body.status,"TOOL_EXECUTED");assert.equal(validUnifiedResult(done.body.bundle),true);
      assert.ok(done.body.bundle.memory_write.receipt_sha256);assert.equal(memory.documents.size,2);
      assert.deepEqual(await request(b,new ExecutorRegistry(),sb.token,path,body),done);
      assert.deepEqual(counts,{model:1,create:1,execute:1,cleanup:1});
      console.info("P1_FIX_01_PROOF "+JSON.stringify({case:"parallel-API-model-worker-memory",route:path,mode:"FIXTURE",execution_id:body.execution_id,counts,memory_documents:memory.documents.size,receipt:done.body.bundle.run.proof.receipt_sha256}));
    }
  }finally{globalThis.fetch=original;}
});

test("P1 FIX: rzeczywisty JeversonChat wysyła ten sam conversation_id przez dwie wiadomości, z pamięcią i bez",async()=>{
  // Wykonujemy istniejący komponent TSX i jego submit; hooki/JSX są kontrolowane.
  // To test kontraktu komponentu, nie test układu ani przeglądarki.
  const source=await readFile(resolve("dashboard-src/src/views/JeversonChat.tsx"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({id:"FIXTURE_MODEL",model:"fixture",choices:[{message:{content:"odpowiedź kontraktowa"}}]});
    for(const enabled of [false,true]){
      const memory=contractMemory(),state=new ApiState(undefined,undefined,undefined,"session",undefined,enabled?new BrainControlPlane(undefined,memory.adapter):undefined,undefined,{...env,NVIDIA_API_KEY:"FIX_UI_"+randomUUID()});
      const session=ensureContractStorage(state).sessions.create(identity),registry=new ExecutorRegistry(),values:any[]=[],effects:Array<()=>unknown>=[],payloads:any[]=[];let cursor=0,initial=true;
      const hooks={useState(init:any){const i=cursor++;if(!(i in values))values[i]=typeof init==="function"?init():init;return [values[i],(v:any)=>{values[i]=typeof v==="function"?v(values[i]):v;}];},useRef:(v:any)=>({current:v}),useEffect(fn:()=>unknown){if(initial)effects.push(fn);}};
      const jsx=(type:any,props:any)=>({type,props});const local=new Map<string,string>();const module={exports:{} as any};
      const context={module,exports:module.exports,require:(name:string)=>{
        if(name==="react")return hooks;if(name==="react/jsx-runtime")return {jsx,jsxs:jsx,Fragment:"fragment"};
        if(name==="../ctx")return {useOsa:()=>({go(){},inspectExecution(){}})};
        if(name==="../AccessBoundary")return {useAccessScope:()=>"test",scopedStorageKey:(k:string)=>k};
        if(name==="../lib/verify")return {verifyRun:async()=>[]};
        if(name==="../ui/primitives")return {statusText:(v:any)=>String(v)};
        if(name==="../ui/ApiConnections")return {__esModule:true,default:()=>null,PROVIDERS:[{id:"nvidia",name:"NVIDIA"}],providerStatus:async()=>({providers:[{id:"nvidia",configured:true,source:"SERVER_ENV"}]})};
        throw Error("NIEZNANY_IMPORT_"+name);
      },crypto:{randomUUID},localStorage:{getItem:(k:string)=>local.get(k)??null,setItem:(k:string,v:string)=>local.set(k,v)},location:{search:""},window:{addEventListener(){},removeEventListener(){}},AbortController,URLSearchParams,Date,
      fetch:async(url:string,init?:RequestInit)=>{
        const payload=init?.body?JSON.parse(String(init.body)):undefined;
        if(url==="/api/nvidia/status")return Response.json({configured:true});
        if(url==="/api/build/status")return Response.json({mode:"fixture"});
        payloads.push(payload);const result=await request(state,registry,session.token,url.replace(/^\/api/,""),payload);return Response.json(result.body,{status:result.status});
      }};
      runInNewContext(compiled,context);const Component=module.exports.default;
      const render=()=>{cursor=0;const tree=Component();initial=false;return tree;};
      const find=(node:any,predicate:(n:any)=>boolean):any=>{
        if(!node||typeof node!=="object")return undefined;if(Array.isArray(node)){for(const item of node){const found=find(item,predicate);if(found)return found;}return;}
        if(predicate(node))return node;return find(node.props?.children,predicate);
      };
      render();for(const effect of effects)effect();await new Promise(r=>setImmediate(r));
      for(const text of ["Pierwsza wiadomość kontraktu","Druga wiadomość kontraktu"]){
        let tree=render();const composer=find(tree,n=>n.props?.["data-testid"]==="osa-composer");assert.ok(composer);
        composer.props.onChange({target:{value:text}});tree=render();const form=find(tree,n=>n.type==="form");assert.ok(form);
        await form.props.onSubmit({preventDefault(){}});
        await new Promise(r=>setImmediate(r));
      }
      assert.equal(payloads.length,2);assert.match(payloads[0].conversation_id,/^[a-f0-9-]{36}$/i);
      assert.equal(payloads[0].conversation_id,payloads[1].conversation_id);
      assert.match(payloads[0].execution_id,/^exec_[a-f0-9-]{36}$/);assert.notEqual(payloads[0].execution_id,payloads[1].execution_id);
      assert.equal(enabled?memory.documents.size:memory.requests,enabled?2:0);
      console.info("P1_FIX_01_PROOF "+JSON.stringify({case:"actual-JeversonChat-TSX",memory:enabled,conversation_ids:payloads.map(p=>p.conversation_id),messages:payloads.length,browser:false}));
    }
  }finally{globalThis.fetch=original;}
});
