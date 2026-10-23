import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { handleWorkerRequest, WorkerState } from "../apps/worker/src";
import { DockerWorkspaceProvider } from "../packages/workspace-runtime/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import { createExecutionGuard, executeUnified, installUnifiedTools, verifyUnifiedBundle } from "../apps/api/src/unified";
import { DurableStore, StorageError } from "../apps/api/src/durable-store";
import { completeProvider } from "../apps/api/src/provider-chat";
import { digest, verifyProofReceipt } from "../packages/proof-core/src";
import { storage02, chat02, message02, model02, request02, identity02, docker02 } from "./p1-fix-02-fixtures";
import { fixtureCleanup } from "./p1-fix-01-fixtures";

const proof=(v:unknown)=>console.info("P1_FIX_02_PROOF "+JSON.stringify(v));
const workerToken="FIXTURE_FIX02_WORKER_TOKEN_12345678901234567890";
async function sandbox02(mode:string){
  const docker=docker02(),provider=new DockerWorkspaceProvider({cli:docker.cli});let state=new WorkerState();
  const fetcher=(async(url,init)=>{
    if(init?.method==="DELETE"){
      if(mode==="legacy-false")return Response.json({ok:true,removed:false});
      if(mode==="contradictory"){
        const body=JSON.parse(String(init.body)),id=[...docker.containers.keys()][0];
        return Response.json({ok:true,removed:false,cleanup:fixtureCleanup(id,body.scope)});
      }
      if(mode!=="normal"&&mode!=="exec-failure"){
        for(const record of state.workspaces.values())clearTimeout(record.timer);
        state=new WorkerState();
        if(mode==="absent")docker.containers.clear();
        if(mode==="unknown")docker.setUnavailable(true);
        if(mode==="foreign")for(const r of docker.containers.values())r.Config.Labels["osa.organization_id"]="foreign";
      }
    }
    if(mode==="exec-failure")docker.setExecFailure(true);
    const req=Readable.from(init?.body?[Buffer.from(String(init.body))]:[]) as any;
    Object.assign(req,{method:init?.method,url:new URL(String(url)).pathname,headers:{authorization:"Bearer "+workerToken}});
    let status=0,body:any;const res={writeHead(v:number){status=v;},end(v:string){body=JSON.parse(v);}} as any;
    await handleWorkerRequest(req,res,{token:workerToken,provider,scope:{organization_id:"org_fix",project_id:"osa-proof"}},state);
    return Response.json(body,{status});
  }) as typeof fetch;
  const registry=new ExecutorRegistry();installUnifiedTools(registry,{OSA_WORKER_BASE_URL:"https://fixture-worker.invalid",OSA_WORKER_TOKEN:workerToken},fetcher);
  const input={message:"test cleanupu FIX02",execution_id:"exec_"+randomUUID(),tool:"osa.worker.sha256.v1",args:{text:"FIX02"},selection:{provider:"nvidia",model:"fixture",response_sha256:"a".repeat(64)}};
  try{return {result:await executeUnified(input,"org_fix",registry,"osa-proof",{store:storage02().store}),docker};}
  finally{for(const record of state.workspaces.values())clearTimeout(record.timer);}
}

test("FIX02 R1 kontrpróba: HTTP 200 removed:false bez potwierdzenia nie daje VERIFIED",async()=>{
  const {result,docker}=await sandbox02("legacy-false");
  proof({case:"R1-removed-false",mode:"FIXTURE",verdict:result.run.verdict,alive:docker.containers.size,cleanupEvidence:result.run.evidence.map(e=>e.kind)});
  assert.notEqual(result.run.verdict,"VERIFIED");assert.equal(result.status,"BLOCKED");assert.equal(docker.containers.size,1);
  assert.ok(result.run.evidence.some(e=>e.kind==="sandbox_cleanup_failure"));
});
for(const mode of ["recover","absent","unknown","foreign","normal","exec-failure","contradictory"]){
  test("FIX02 R1: rzeczywisty handler Workera i Docker CLI FIXTURE — "+mode,async()=>{
    const {result,docker}=await sandbox02(mode),success=["recover","absent","normal"].includes(mode);
    proof({case:"R1-"+mode,mode:"FIXTURE",verdict:result.run.verdict,alive:docker.containers.size,calls:docker.calls.map(c=>c[0])});
    assert.equal(result.run.verdict==="VERIFIED",success);
    if(success){
      assert.equal(docker.containers.size,0);assert.equal(verifyUnifiedBundle(result).ok,true);
      const sandbox=result.run.evidence.find(e=>e.kind==="sandbox_receipt")!;
      assert.equal((sandbox.data.cleanup as any)?.confirmed,true);
      assert.equal(verifyProofReceipt({receipt:result.run.proof,evidence:result.run.evidence,observations:result.run.observations,final_output:result.run.final_output}).ok,true);
      const tampered=structuredClone(result);(tampered.run.evidence.find(e=>e.kind==="sandbox_receipt")!.data.cleanup as any).confirmed=false;
      assert.equal(verifyUnifiedBundle(tampered).ok,false);
    }else assert.equal(result.run.evidence.some(e=>e.kind==="sandbox_receipt"),false);
    if(mode==="unknown"||mode==="foreign")assert.equal(docker.calls.filter(c=>c[0]==="rm").length,0);
  });
}

for(const [route,provider] of [["/nvidia/fleet-chat","nvidia"],["/nvidia/chat","nvidia"],["/models/chat","nvidia"],["/models/chat","openrouter"]]){
  for(const enabled of [false,true])test(`FIX02 R2: ${route} ${provider} memory=${enabled} — replay, konflikt, restart, równoległość`,async()=>{
    const fixture=chat02(enabled),original=globalThis.fetch;let calls=0,release!:()=>void,started!:()=>void;
    const wait=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
    globalThis.fetch=async(url,init)=>{
      if(String(url)===fixture.env.OSA_STORAGE_URL)return fixture.storage.fetch(url,init);
      assert.ok(["https://integrate.api.nvidia.com/v1/chat/completions","https://openrouter.ai/api/v1/chat/completions"].includes(String(url)));
      calls++;started();await wait;return model02();
    };
    const body={...message02(provider),remember:enabled},first=request02(fixture.state(),route,body);
    try{
      await Promise.race([ready,first.then(()=>{throw Error("MODEL_NOT_STARTED");})]);
      const second=request02(fixture.state(),route,body);
      // Przed FIX02 drugi model również wchodzi do wait; nie zawieszamy kontrpróby.
      await new Promise(r=>setImmediate(r));release();
      const [done,parallel]=await Promise.all([first,second]);
      const replay=await request02(fixture.state(),route,body);
      const conflict=await request02(fixture.state(),route,{...body,prompt:"zmieniony payload"});
      proof({case:"R2-universal",route,provider,memory:enabled,calls,first:done.status,parallel:parallel.status,replay:replay.status,conflict:conflict.body.code});
      assert.equal(done.status,200);assert.ok([200,409].includes(parallel.status));assert.equal(calls,1);
      assert.deepEqual(replay,done);assert.equal(conflict.body.code,"EXECUTION_PAYLOAD_CONFLICT");
      assert.equal(enabled?fixture.memory.documents.size:fixture.memory.requests,enabled?2:0);
    }finally{release();await first.catch(()=>undefined);globalThis.fetch=original;}
  });
  test(`FIX02 R2/R3 kontrpróba: ${route} ${provider} — remember PASS, model wykonany, provenance FAIL`,async()=>{
    const fixture=chat02(),original=globalThis.fetch;let calls=0;
    globalThis.fetch=async(url,init)=>{
      if(String(url)===fixture.env.OSA_STORAGE_URL)return fixture.storage.fetch(url,init);
      calls++;fixture.memory.setFailProvenance(true);return model02();
    };
    try{
      const body=message02(provider),first=await request02(fixture.state(),route,body),retry=await request02(fixture.state(),route,body);
      proof({case:"R2-R3-partial-memory",route,provider,calls,first:first.body,retry:retry.body,documents:fixture.memory.documents.size});
      assert.equal(first.status,502);assert.equal(fixture.memory.documents.size,1);assert.ok(first.body.memory_write?.receipt_sha256);
      assert.deepEqual(retry.body.memory_write,first.body.memory_write);assert.equal(calls,1);
      assert.equal(first.body.execution_progress.model,"COMPLETED");assert.equal(retry.body.execution_progress.model,"COMPLETED");
      assert.equal(first.body.memory,undefined);assert.equal(first.body.memory_write.scope.organization_id,"org_fix");assert.equal(first.body.memory_write.scope.project_id,"osa-proof");
    }finally{globalThis.fetch=original;}
  });
}

test("FIX02 R2: brak ID/storage, odrzucony recall/remember i niedozwolony scope nie uruchamiają modelu",async()=>{
  const original=globalThis.fetch;
  try{
    for(const provider of ["nvidia","openrouter"]){
      const f=chat02(),route=provider==="nvidia"?"/nvidia/fleet-chat":"/models/chat";let calls=0;
      globalThis.fetch=async(url,init)=>{if(String(url)===f.env.OSA_STORAGE_URL)return f.storage.fetch(url,init);calls++;return model02();};
      const body=message02(provider);
      assert.equal((await request02(f.state(),route,{...body,execution_id:undefined})).status,400);
      f.storage.setUnavailable(true);assert.equal((await request02(f.state(),route,body)).status,503);f.storage.setUnavailable(false);
      f.memory.setAvailable(false);assert.equal((await request02(f.state(),route,{...body,execution_id:"exec_"+randomUUID()})).status,502);f.memory.setAvailable(true);
      f.memory.setWrites(false);assert.equal((await request02(f.state(),route,{...body,execution_id:"exec_"+randomUUID()})).status,502);
      assert.equal((await request02(f.state(),route,{...body,execution_id:"exec_"+randomUUID()},{...identity02,project_ids:["foreign"]})).status,403);
      assert.equal(calls,0);proof({case:"R2-pre-model-gates",provider,calls});
    }
  }finally{globalThis.fetch=original;}
});

test("FIX02 R2: awaria zapisu po modelu nie zezwala na ponowne wykonanie",async()=>{
  const f=chat02(false),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,init)=>{if(String(url)===f.env.OSA_STORAGE_URL)return f.storage.fetch(url,init);calls++;f.storage.setRejectCompletion(true);return model02();};
  try{
    const body={...message02(),remember:false},first=await request02(f.state(),"/nvidia/fleet-chat",body);
    f.storage.setRejectCompletion(false);const retry=await request02(f.state(),"/nvidia/fleet-chat",body);
    assert.equal(first.status,503);assert.equal(retry.status,409);assert.equal(retry.body.code,"EXECUTION_IN_PROGRESS");assert.equal(calls,1);
    proof({case:"R2-completion-storage-failure",calls,first:first.body.code,retry:retry.body.code});
  }finally{globalThis.fetch=original;}
});

test("FIX02 R2: rezerwacja wiąże autora i scope; osierocone IN_PROGRESS nie jest przejmowane",async()=>{
  const s=storage02(),id="exec_"+randomUUID(),payload={conversation_id:randomUUID()},a=createExecutionGuard(s.store,"org_fix:osa-proof","actor-A");let calls=0;
  const run=async()=>{calls++;return {ok:true};};
  await assert.rejects(a(id,payload,async()=>{throw Error("FIXTURE_CRASH");},()=>true));
  await assert.rejects(createExecutionGuard(s.store,"org_fix:osa-proof","actor-A")(id,payload,run,()=>true),(e:any)=>e.code==="EXECUTION_IN_PROGRESS"||e.code==="EXECUTION_FAILED");
  await assert.rejects(createExecutionGuard(s.store,"org_fix:osa-proof","actor-B")(id,payload,run,()=>true),(e:any)=>e.code==="EXECUTION_PAYLOAD_CONFLICT");
  await createExecutionGuard(s.store,"foreign:osa-proof","actor-A")(id,payload,run,()=>true);assert.equal(calls,1);
});

for(const count of [51,125])test(`FIX02 R4 kontrpróba: ${count} wykonań / ${2*count} rekordów — restart i najstarszy/najnowszy run`,async()=>{
  const f=chat02(false),original=globalThis.fetch,registry=new ExecutorRegistry();installUnifiedTools(registry,{});
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),f.env.OSA_STORAGE_URL);return f.storage.fetch(url,init);};
  try{
    const state=f.state(),session=state.sessions.create(identity02),results=[];
    for(let i=0;i<count;i++)results.push(await state.executeUnified({message:"Oblicz SHA-256 tekstu: FIX02-"+i,execution_id:"exec_"+randomUUID()},"org_fix",registry,"osa-proof",session));
    assert.equal(f.storage.rows.size,2*count);const restarted=f.state();
    const oldest=await request02(restarted,"/runs/"+results[0].run.run_id),newest=await request02(restarted,"/runs/"+results.at(-1)!.run.run_id);
    proof({case:"R4-history",count,rows:f.storage.rows.size,restored:restarted.runs.size,oldest:oldest.status,newest:newest.status,queries:f.storage.queries.filter(q=>q.includes("order=")).length});
    assert.equal(oldest.status,200);assert.equal(newest.status,200);assert.equal(restarted.runs.size,count);
    assert.equal(oldest.body.proof.receipt_sha256,results[0].run.proof.receipt_sha256);
    assert.equal((await request02(restarted,"/runs/"+results[0].run.run_id,undefined,{...identity02,organization_id:"foreign"})).status,403);
    assert.equal((await request02(restarted,"/runs/"+results[0].run.run_id,undefined,{...identity02,project_ids:["foreign"]})).status,403);
    const foreign=f.state();await foreign.restoreExecutions("org_fix","foreign");assert.equal(foreign.runs.size,0);
  }finally{globalThis.fetch=original;}
});

test("FIX02 R4: nieobsługiwane lub niepostępujące stronicowanie jest odrzucane",async()=>{
  const s=storage02();
  for(const body of [{records:[]},{records:[{record_id:"a",revision:1,payload:{}}],next_cursor:"a"}]){
    const store=new DurableStore(s.env,(async()=>Response.json(body)) as typeof fetch);
    await assert.rejects(store.list("org_fix:osa-proof","executions"),(e:unknown)=>e instanceof StorageError);
  }
});

test("FIX02 R2: kontrakt źródła Jeverson przechowuje execution_id także dla text chat",()=>{
  const source=readFileSync("dashboard-src/src/views/JeversonChat.tsx","utf8");
  assert.match(source,/execution_id:executionId/);assert.match(source,/addMessage\(sessionId,"user",text,"USER",\{executionId\}\)/);
  assert.ok(!source.includes('execute_tools:true,execution_id:"exec_"+id()'));
});

test("FIX02 R1: odzyskiwany cleanup jest idempotentny; błąd demona nie jest dowodem ABSENT",async()=>{
  const docker=docker02(),provider=new DockerWorkspaceProvider({cli:docker.cli});
  const request={workspaceId:"fix02-recovery",timeoutMs:60000,scope:{organization_id:"org_fix",project_id:"osa-proof",mission_id:"fix02",task_id:"task"}};
  const workspace=await provider.create(request);
  assert.equal((await provider.recoverCleanup!(workspace.id,request)).state,"REMOVED");
  assert.equal((await provider.recoverCleanup!(workspace.id,request)).state,"ABSENT");
  docker.setUnavailable(true);
  assert.equal((await provider.recoverCleanup!(workspace.id,request)).confirmed,false);
  assert.equal(docker.calls.filter(c=>c[0]==="rm").length,1);
});

test("FIX02 R2: istniejący wspólny kontrakt OpenAI/Anthropic/compatible rezerwuje i odtwarza wynik",async()=>{
  const original=globalThis.fetch;
  try{
    for(const provider of ["openai","anthropic","compatible"] as const){
      const storage=storage02(),body={...message02(provider),remember:false};let calls=0;
      globalThis.fetch=async()=>{calls++;return provider==="anthropic"?Response.json({id:"FIXTURE_ANTHROPIC",model:"fixture",stop_reason:"end_turn",content:[{type:"text",text:"FIX02"}],usage:{input_tokens:1,output_tokens:1}}):model02();};
      const connection={provider,apiKey:"FIXTURE_COMMON_"+randomUUID(),model:"fixture",allowPaid:true,...(provider==="compatible"?{baseUrl:"https://fixture-compatible.invalid/v1"}:{})};
      const options={guard:createExecutionGuard(storage.store,"org_fix:osa-proof","common-test")};
      const result=await completeProvider(connection,body,{},undefined,options);
      assert.deepEqual(await completeProvider(connection,body,{},undefined,options),result);
      await assert.rejects(completeProvider(connection,{...body,prompt:"inny payload"},{},undefined,options),(e:any)=>e.code==="EXECUTION_PAYLOAD_CONFLICT");
      assert.equal(calls,1);proof({case:"R2-common-provider",provider,calls,mode:"FIXTURE"});
    }
  }finally{globalThis.fetch=original;}
});

test("FIX02 R2/R3: nowy proces odtwarza odpowiedź/błąd pamięci i blokuje osierocony model bez ponowienia",()=>{
  const directory=mkdtempSync(join(tmpdir(),"osa-fix02-restart-"));
  const script=`const {nvidiaChat}=require('./dist/apps/api/src/nvidia');const {createExecutionGuard,executionErrorContext}=require('./dist/apps/api/src/unified');
    const {contractStore,contractMemory}=require('./dist/tests/p1-fix-01-fixtures');const {MemoryService}=require('./dist/apps/api/src/memory');const {SessionStore}=require('./dist/packages/session/src');
    const identity=JSON.parse(process.argv[5]),session=new SessionStore().create(identity),memory=contractMemory(),body=JSON.parse(process.argv[2]);
    (async()=>{try{const result=await nvidiaChat(body,{env:{NVIDIA_API_KEY:process.argv[3]},session,memory:body.remember?new MemoryService(memory.adapter):undefined,
      guard:createExecutionGuard(contractStore(process.argv[1]).store,'org_fix:osa-proof','restart-model'),fetch:async()=>{console.log('MODEL_STARTED');
        if(process.argv[4]==='orphan')process.exit(17);if(process.argv[4]==='memory-fail')memory.setFailProvenance(true);
        return Response.json({id:'FIXTURE_RESTART',model:'fixture',choices:[{message:{content:'FIX02 restart'}}]});}});console.log(JSON.stringify({status:result.status,request_id:result.request_id}));}
      catch(e){console.log(JSON.stringify({code:e.code,...executionErrorContext(e)}));}})().catch(()=>process.exit(1));`;
  try{
    for(const mode of ["success","memory-fail","orphan"]){
      const file=join(directory,mode+".sqlite"),body={...message02(),remember:mode==="memory-fail"},key="FIXTURE_RESTART_KEY_"+randomUUID();
      const run=()=>spawnSync(process.execPath,["--require","./artifacts/p1-fix-02/no-external-network.cjs","-e",script,file,JSON.stringify(body),key,mode,JSON.stringify(identity02)],{encoding:"utf8",env:{PATH:process.env.PATH}});
      const first=run(),retry=run();assert.equal(first.status,mode==="orphan"?17:0,first.stderr);assert.equal(retry.status,0,retry.stderr);
      assert.equal((first.stdout+retry.stdout).split("MODEL_STARTED").length-1,1);
      const replay=JSON.parse(retry.stdout.trim());
      if(mode==="success")assert.deepEqual(replay,JSON.parse(first.stdout.trim().split("\n").at(-1)!));
      if(mode==="memory-fail"){assert.equal(replay.code,"MEMORY_OPERATION_FAILED");assert.ok(replay.memory_write.receipt_sha256);assert.equal(replay.execution_progress.model,"COMPLETED");}
      if(mode==="orphan"){assert.equal(replay.code,"EXECUTION_IN_PROGRESS");assert.equal(replay.execution_progress.model,"STARTED_UNCONFIRMED");}
      proof({case:"R2-R3-process-restart",mode,model_calls:1,replay:replay.code??replay.status,storage:"TEMPORARY_SQLITE_CONTRACT"});
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

// Wykonujemy oryginalny TSX i jego handlery, a przechwycony payload przekazujemy
// bez uzupełniania ID do rzeczywistego API. Tylko hooki/DOM, model i storage są FIXTURE.
function client03(kind:"guide"|"nvidia",route:"fleet"|"gateway-nvidia"|"gateway-openrouter"="fleet"){
  const file=kind==="guide"?"dashboard-src/src/views/OsaHelpDock.tsx":"dashboard-src/src/ui/NvidiaChat.tsx";
  const compiled=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const slots:any[]=[],effects:Array<()=>unknown>=[],timers=new Map<number,()=>void>();let cursor=0,sequence=0,view="home";
  const hooks={
    useState(init:any){const i=cursor++;if(!(i in slots))slots[i]=typeof init==="function"?init():init;return [slots[i],(value:any)=>{slots[i]=typeof value==="function"?value(slots[i]):value;}];},
    useRef(value:any){const i=cursor++;return slots[i]??(slots[i]={current:value});},
    useId(){const i=cursor++;return slots[i]??(slots[i]="fix03-"+i);},
    useMemo(fn:()=>unknown,deps:any[]){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))slots[i]={deps,value:fn()};return slots[i].value;},
    useEffect(fn:()=>unknown,deps:any[]=[]){const i=cursor++,old=slots[i];if(!old||deps.some((v,n)=>v!==old[n])){slots[i]=deps;effects.push(fn);}}
  };
  const jsx=(type:any,props:any)=>({type,props}),module={exports:{} as any};
  const providers={providers:[{id:"nvidia",name:"NVIDIA",source:route==="gateway-nvidia"?"PRIVATE_SERVER_STORE":"SERVER_ENV"},{id:"openrouter",name:"OpenRouter",source:"SERVER_ENV"}]};
  const captured:Array<{url:string;body:string;payload:any;status:number;code?:string}>=[],requests:Promise<unknown>[]=[];
  let exchange!:(url:string,body:any)=>Promise<{status:number;body:any}>,fault:"none"|"lost"|"timeout"|"conflict"="none";
  const context={module,exports:module.exports,require:(name:string)=>{
    if(name==="react")return hooks;if(name==="react/jsx-runtime")return {jsx,jsxs:jsx,Fragment:"fragment"};
    if(name==="../ctx")return {useOsa:()=>({view,go:(next:string)=>{view=next;}})};
    if(name==="../nav")return {HOME_ITEM:{view:"home",label:"Strona główna",built:true},NAV:[]};
    if(name==="../ui/ApiConnections")return {PROVIDERS:providers.providers,providerStatus:async()=>providers};
    throw Error("FIX03_IMPORT_DENIED_"+name);
  },crypto:{randomUUID},AbortController,
  AbortSignal:{timeout:()=>{const ctl=new AbortController();timers.set(++sequence,()=>ctl.abort());return ctl.signal;}},
  setTimeout:(fn:()=>void)=>{timers.set(++sequence,fn);return sequence;},clearTimeout:(id:number)=>timers.delete(id),
  localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null},
  window:{addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){}},
  fetch:(url:string,init?:RequestInit)=>{const request=(async()=>{
    if(url==="/api/nvidia/status")return Response.json({configured:true,model:"nvidia/nemotron-3-super-120b-a12b"});
    assert.ok(init?.body,"FIX03: żądanie modelowe bez body");
    const body=String(init.body),payload=JSON.parse(body),mode=fault;fault="none";
    const entry={url,body,payload,status:0,code:undefined as string|undefined};captured.push(entry);
    // Rezerwacja innego payloadu symuluje istniejący konflikt po stronie serwera.
    if(mode==="conflict")assert.equal((await exchange(url,{...payload,prompt:payload.prompt+" — konflikt FIXTURE"})).status,200);
    const result=await exchange(url,payload);entry.status=result.status;entry.code=result.body.code;
    if(mode==="timeout"){for(const callback of timers.values())callback();throw new Error("FIXTURE_TIMEOUT_PO_WYKONANIU");}
    if(mode==="lost")throw new TypeError("FIXTURE_UTRATA_ODPOWIEDZI_PO_WYKONANIU");
    return Response.json(result.body,{status:result.status});
  })();requests.push(request);return request;}};
  runInNewContext(compiled,context);const Component=module.exports.default;
  const render=()=>{cursor=0;return Component();};
  const find=(node:any,predicate:(n:any)=>boolean):any=>{
    if(!node||typeof node!=="object")return undefined;
    if(Array.isArray(node)){for(const child of node){const match=find(child,predicate);if(match)return match;}return undefined;}
    return predicate(node)?node:find(node.props?.children,predicate);
  };
  const flush=async()=>{for(let i=0;i<3;i++){render();while(effects.length)effects.shift()!();await Promise.allSettled(requests.splice(0));await new Promise(r=>setImmediate(r));}};
  const field=()=>find(render(),n=>n.type==="textarea");
  return {captured,bind:(fn:typeof exchange)=>{exchange=fn;},fault:(mode:typeof fault)=>{fault=mode;},navigate:(next:string)=>{view=next;},
    async init(){await flush();if(kind==="guide"){find(render(),n=>n.props?.["data-testid"]==="osa-help-trigger").props.onClick();await flush();if(route==="gateway-openrouter")this.provider("openrouter");}},
    provider(value:string){find(render(),n=>n.props?.["aria-label"]==="Dostawca przewodnika OSA").props.onChange({target:{value}});},
    model(value:string){find(render(),n=>n.type==="select").props.onChange({target:{value}});},
    draft(value:string){field().props.onChange({target:{value}});},
    async send(){const form=find(render(),n=>n.type==="form");await form.props.onSubmit({preventDefault(){}});await flush();},
    async retry(){const button=find(render(),n=>n.props?.["data-testid"]==="model-request-retry");assert.ok(button,"Brakuje jawnego retry tego samego żądania");await button.props.onClick({preventDefault(){}});await flush();},
    async doubleSend(){const form=find(render(),n=>n.type==="form");await Promise.all([form.props.onSubmit({preventDefault(){}}),form.props.onSubmit({preventDefault(){}})]);await flush();},
    hasError:()=>!!find(render(),n=>n.props?.role==="alert"),hasRetry:()=>!!find(render(),n=>n.props?.["data-testid"]==="model-request-retry")};
}

for(const [kind,route,path] of [
  ["guide","fleet","/api/nvidia/fleet-chat"],
  ["guide","gateway-nvidia","/api/models/chat"],
  ["guide","gateway-openrouter","/api/models/chat"],
  ["nvidia","fleet","/api/nvidia/chat"]
] as const)for(const enabled of [false,true]){
  async function scenario(run:(client:ReturnType<typeof client03>,fixture:ReturnType<typeof chat02>,calls:()=>number)=>Promise<void>){
    const f=chat02(enabled),original=globalThis.fetch;let calls=0;
    globalThis.fetch=async(url,init)=>{if(String(url)===f.env.OSA_STORAGE_URL)return f.storage.fetch(url,init);assert.ok(["https://integrate.api.nvidia.com/v1/chat/completions","https://openrouter.ai/api/v1/chat/completions"].includes(String(url)));calls++;return model02("odpowiedź kontraktowa FIX03");};
    const state=f.state();
    const client=client03(kind,route);client.bind((url,payload)=>request02(state,url.replace(/^\/api/,""),payload));
    try{await client.init();await run(client,f,()=>calls);}finally{globalThis.fetch=original;}
  }
  const label=`FIX03 ${kind}/${route} memory=${enabled}`;
  test(label+": nowa wiadomość — nowe wykonanie, stabilna rozmowa",{timeout:15000},async()=>scenario(async(c,f,calls)=>{
    for(let i=0;i<2;i++){c.draft("Ta sama treść nowej wiadomości");await c.send();if(c.hasError())console.info("P1_FIX_03_PROOF "+JSON.stringify({case:"new-message-rejected",client:kind,gateway:route,memory:enabled,requests:c.captured,mode:"ACTUAL_TSX_API_FIXTURE"}));assert.equal(c.captured.at(-1)?.status,200);assert.equal(c.hasError(),false);}
    const [a,b]=c.captured;assert.equal(c.captured.length,2);assert.equal(a.url,path);assert.equal(b.url,path);
    assert.match(a.payload.execution_id,/^exec_[a-f0-9-]{36}$/);assert.match(b.payload.execution_id,/^exec_[a-f0-9-]{36}$/);
    assert.notEqual(a.payload.execution_id,b.payload.execution_id);assert.match(a.payload.conversation_id,/^[a-f0-9-]{36}$/i);assert.equal(a.payload.conversation_id,b.payload.conversation_id);
    assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls(),2);assert.equal(c.hasRetry(),false);
    assert.equal(enabled?f.memory.documents.size:f.memory.requests,enabled?2:0);
    console.info("P1_FIX_03_PROOF "+JSON.stringify({case:"new-message",client:kind,route:path,gateway:route,memory:enabled,model_calls:calls(),statuses:c.captured.map(x=>x.status),execution_ids:c.captured.map(x=>x.payload.execution_id),conversation_id:a.payload.conversation_id,mode:"ACTUAL_TSX_API_FIXTURE"}));
  }));
  for(const fault of ["lost","timeout"] as const)test(label+": "+fault+" — retry zachowuje identyczny payload i trasę",{timeout:15000},async()=>scenario(async(c,_f,calls)=>{
    c.draft("Żądanie z niepewnym wynikiem");c.fault(fault);await c.send();assert.equal(c.hasError(),true);assert.equal(calls(),1);
    // Mutacje formularza i nawigacji nie mogą zmieniać zapisanego retry.
    c.draft("Inny szkic");c.navigate("proofs");if(kind==="guide")c.provider(route==="gateway-openrouter"?"nvidia":"openrouter");else c.model("inny/model");
    await c.retry();assert.equal(c.hasError(),false);assert.equal(c.captured.length,2);assert.equal(c.captured[0].body,c.captured[1].body);assert.equal(c.captured[0].url,c.captured[1].url);assert.equal(c.captured[1].status,200);assert.equal(calls(),1);assert.equal(c.hasRetry(),false);
    console.info("P1_FIX_03_PROOF "+JSON.stringify({case:fault+"-retry",client:kind,route:path,gateway:route,memory:enabled,model_calls:calls(),byte_identical_payload:true,same_route:true,execution_id:c.captured[0].payload.execution_id,mode:"ACTUAL_TSX_API_FIXTURE"}));
  }));
  test(label+": rzeczywisty 409 nie zmienia ID; nowa operacja jest jawna",{timeout:15000},async()=>scenario(async(c,_f,calls)=>{
    c.draft("Wiadomość z konfliktem");c.fault("conflict");await c.send();assert.equal(c.hasError(),true);assert.equal(c.captured[0].status,409);assert.equal(c.captured[0].code,"EXECUTION_PAYLOAD_CONFLICT");
    await c.retry();assert.equal(c.hasError(),true);assert.equal(c.captured[1].status,409);assert.equal(c.captured[0].body,c.captured[1].body);assert.equal(calls(),1);
    c.draft("Wiadomość z konfliktem");await c.send();assert.equal(c.captured[2].status,200);assert.notEqual(c.captured[2].payload.execution_id,c.captured[0].payload.execution_id);assert.equal(c.captured[2].payload.conversation_id,c.captured[0].payload.conversation_id);assert.equal(calls(),2);
    console.info("P1_FIX_03_PROOF "+JSON.stringify({case:"409-explicit-new-operation",client:kind,route:path,gateway:route,memory:enabled,statuses:c.captured.map(x=>x.status),model_calls:calls(),mode:"ACTUAL_TSX_API_FIXTURE"}));
  }));
  test(label+": podwójne wywołanie handlera nie tworzy dwóch operacji",{timeout:15000},async()=>scenario(async(c,_f,calls)=>{
    c.draft("Szybkie podwójne kliknięcie");await c.doubleSend();assert.equal(c.captured.length,1);assert.equal(c.captured[0].status,200);assert.equal(calls(),1);
  }));
}
