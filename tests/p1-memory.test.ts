// FIXTURE kontraktów modelu, NeurOSA i magazynu HTTP. Prawdziwy OSA Runtime,
// adapter, hashowanie i kontrola uprawnień; brak dowodu LIVE NeurOSA/Postgres.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomUUID,verify} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import type {AddressInfo} from "node:net";
import {ApiState,createApiServer} from "../apps/api/src";
import {MemoryAccessError} from "../apps/api/src/memory";
import {nvidiaChat as nvidiaChatRaw,NvidiaError,type NvidiaChatBody,type NvidiaChatOptions} from "../apps/api/src/nvidia";
import {StorageError} from "../apps/api/src/durable-store";
import {NeurosaMemoryAdapter} from "../packages/adapters/src/brain";
import {BrainControlPlane} from "../packages/brain/src";
import {sealMemoryEvent} from "../packages/brain/src/memory";
import {ExecutorRegistry} from "../packages/runtime/src";
import {executeUnified,installUnifiedTools,verifyUnifiedBundle,createExecutionGuard} from "../apps/api/src/unified";

import {contractStore} from "./p1-fix-01-fixtures";
// Każde niezależne wywołanie testu otrzymuje wymagane ID i lokalny trwały kontrakt.
const nvidiaChat=(body:NvidiaChatBody,options:NvidiaChatOptions)=>nvidiaChatRaw({execution_id:"exec_"+randomUUID(),...body},
  {guard:createExecutionGuard(contractStore().store,(options.session?.identity.organization_id??"org_p1")+":osa-proof","memory-test"),...options});

const env={NVIDIA_API_KEY:"P1_SYNTHETIC_KEY",NVIDIA_MODEL:"nvidia/p1-contract"};
const identity={identity_id:"p1-test",provider:"microsoft" as const,subject:"FIXTURE_TRUSTED_IDENTITY",display_name:"Test P1",verified:true,roles:[],organization_id:"org_p1",project_ids:["osa-proof"]};
function memoryFixture(){
  const documents=new Map<string,{documentId:string;revision:number;content:string;contentHash:string}>();
  const state={requests:0,failWrites:false,failStatus:false,tamper:false};
  const fetcher=(async(url,init)=>{
    state.requests++;assert.equal((init?.headers as Record<string,string>).authorization,"Bearer P1_SYNTHETIC_NEUROSA_TOKEN_123456");
    const path=new URL(String(url)).pathname;
    if(path.endsWith("brain/status"))return state.failStatus?new Response("secret upstream",{status:503}):Response.json({brainId:"brain_p1",ledgerValid:true});
    if(path.endsWith("brain/recall"))return Response.json({brainId:"brain_p1",ledgerValid:true,text:[...documents.values()].map(x=>x.content).join("\n"),references:[...documents.values()].map(x=>({documentId:x.documentId})),ledgerHead:"FIXTURE_LEDGER",truncated:false});
    if(path.includes("/documents/")){
      const doc=documents.get(path.split("/").at(-1)!);
      return doc?Response.json({...doc,...(state.tamper?{contentHash:"f".repeat(64)}:{})}):new Response("",{status:404});
    }
    if(state.failWrites)return new Response("secret upstream",{status:503});
    const body=JSON.parse(String(init?.body));const event=JSON.parse(body.content);
    const id="doc_"+event.event_sha256;const duplicate=documents.has(id);
    const doc=documents.get(id)??{documentId:id,revision:1,content:body.content,contentHash:createHash("sha256").update(body.content).digest("hex")};
    documents.set(id,doc);
    return Response.json({status:"ZAPAMIĘTANO",document:doc,deduplicated:duplicate,acceptedRevision:doc.revision});
  }) as typeof fetch;
  const adapter=()=>new NeurosaMemoryAdapter({baseUrl:"https://p1-neurosa.invalid",token:"P1_SYNTHETIC_NEUROSA_TOKEN_123456",brainId:"brain_p1",organizationId:"org_p1",projectId:"osa-proof",fetch:fetcher});
  return {state,documents,adapter};
}
function runtime(memory:ReturnType<typeof memoryFixture>,accessEnv:NodeJS.ProcessEnv={}){
  const state=new ApiState(undefined,undefined,undefined,"session",undefined,new BrainControlPlane(undefined,memory.adapter()),undefined,accessEnv);
  if(!state.durable)Object.defineProperty(state,"durable",{value:contractStore().store});
  const session=state.sessions.create(identity),registry=new ExecutorRegistry();installUnifiedTools(registry,{});
  return {state,session,registry};
}

test("P1 FIXTURE: remember → recall → definicje narzędzi NVIDIA → Runtime → trwały transport → NeurOSA",async()=>{
  const memory=memoryFixture(),pair=generateKeyPairSync("ed25519"),records=new Map<string,unknown>();
  const original=globalThis.fetch;
  globalThis.fetch=(async(url,init)=>{
    assert.equal(String(url),"https://p1-contract.supabase.co/functions/v1/osa-proof-storage");
    const raw=String(init?.body),body=JSON.parse(raw);
    assert.equal(verify(null,Buffer.from(raw),pair.publicKey,Buffer.from((init?.headers as Record<string,string>)["x-osa-signature"],"base64")),true);
    const key=body.namespace+":"+body.scope+":"+body.kind+":"+body.record_id;
    if(body.op==="put"){if(records.has(key))return new Response("",{status:409});records.set(key,{record_id:body.record_id,revision:1,payload:body.payload});}
    return Response.json({record:records.get(key)??null});
  }) as typeof fetch;
  const storage={OSA_STORAGE_URL:"https://p1-contract.supabase.co/functions/v1/osa-proof-storage",OSA_STORAGE_NAMESPACE:"p1-fixture",OSA_STORAGE_PRIVATE_KEY_B64:pair.privateKey.export({format:"der",type:"pkcs8"}).toString("base64")};
  try{
    const r=runtime(memory,storage);let modelCalls=0,toolCalls=0;
    const execution_id="exec_"+randomUUID(),conversation_id=randomUUID();
    const answer=await nvidiaChat({prompt:"Zapamiętaj zadanie i oblicz hash",conversation_id,remember:true,execute_tools:true,execution_id},
      {env,memory:r.state.memory,session:r.session,fetch:async(_url,init)=>{
        modelCalls++;const request=JSON.parse(String(init?.body));assert.equal(request.tools[0].function.name,"osa_sha256");
        assert.match(request.messages[1].content,/niezaufanymi/);
        return Response.json({id:"FIXTURE_RESPONSE",model:env.NVIDIA_MODEL,choices:[{message:{content:null,tool_calls:[{id:"FIXTURE_CALL",type:"function",function:{name:"osa_sha256",arguments:JSON.stringify({text:"P1"})}}]}}]});
      },dispatch:async input=>{toolCalls++;const bundle=await executeUnified(input,"org_p1",r.registry);
        await r.state.rememberExecution(bundle,r.session);return bundle;}});
    assert.ok("bundle" in answer);assert.equal(answer.status,"TOOL_EXECUTED");assert.equal(verifyUnifiedBundle(answer.bundle).ok,true);
    assert.equal(modelCalls,1);assert.equal(toolCalls,1);assert.equal(records.size,1);assert.equal(memory.documents.size,2);
    const restarted=runtime(memory,storage); // Nowy obiekt API; nie deklarujemy restartu serwera ani trwałości prawdziwej bazy.
    const restored=await restarted.state.execution("org_p1","osa-proof",execution_id);
    assert.ok(restored);assert.equal(verifyUnifiedBundle(restored).ok,true);
    assert.equal(await restarted.state.execution("foreign","osa-proof",execution_id),undefined);
    const recalled=await restarted.state.memory.recall(restarted.session,randomUUID(),execution_id);
    assert.ok(recalled.text.includes(restored.run.proof.receipt_sha256));
    assert.equal(restored.mission.input && (restored.mission.input as {selection:{neurosa:{brain_id:string}}}).selection.neurosa.brain_id,"brain_p1");
    if(process.env.OSA_P1_EVIDENCE_DIR){const dir=resolve(process.env.OSA_P1_EVIDENCE_DIR);await mkdir(dir,{recursive:true});await writeFile(resolve(dir,"fixture-bundle.json"),JSON.stringify(restored,null,2));}
  }finally{globalThis.fetch=original;}
});

test("P1 FIXTURE: obcy projekt, local-dev i awaria pamięci blokują model przed I/O",async()=>{
  const memory=memoryFixture(),r=runtime(memory);let modelCalls=0,dispatches=0;
  const options={env,memory:r.state.memory,fetch:async()=>{modelCalls++;throw Error("sieć zabroniona");},dispatch:async()=>{dispatches++;throw Error();}};
  const body={prompt:"prywatna pamięć",conversation_id:randomUUID()};
  for(const override of [{provider:"local-dev" as const},{project_ids:["foreign"]},{organization_id:"foreign"}]){
    const session={...r.session,identity:{...r.session.identity,...override}};
    await assert.rejects(nvidiaChat(body,{...options,session}),e=>e instanceof MemoryAccessError);
  }
  assert.equal(memory.state.requests,0);
  memory.state.failStatus=true;
  await assert.rejects(nvidiaChat(body,{...options,session:r.session}));
  assert.equal(modelCalls,0);assert.equal(dispatches,0);
});

test("P1 FIXTURE: anonimowy open/dev-login nie uzyskuje dostępu do prywatnego brain",async()=>{
  const memory=memoryFixture();const state=new ApiState(undefined,undefined,undefined,"open",undefined,new BrainControlPlane(undefined,memory.adapter()),undefined,{});
  const server=createApiServer(new ExecutorRegistry(),state);
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  try{
    assert.equal((await (await fetch(base+"/memory/status")).json()).state,"ACCESS_REQUIRED");
    const denied=await fetch(base+"/nvidia/fleet-chat",{method:"POST",body:JSON.stringify({prompt:"odczytaj"})});assert.equal(denied.status,401);
    const login=await fetch(base+"/auth/dev-login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({display_name:"test",provider:"microsoft",project_ids:["osa-proof"]})});
    const value=await login.json();assert.equal(value.session.identity.provider,"local-dev");
    const status=await fetch(base+"/memory/status",{headers:{authorization:"Bearer "+value.session.token}});
    assert.equal((await status.json()).state,"ACCESS_REQUIRED");assert.equal(memory.state.requests,0);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test("P1 FIXTURE: awaria zapisu pamięci zachowuje dowód wykonania bez ponowienia narzędzia",async()=>{
  const memory=memoryFixture(),r=runtime(memory);let tools=0;
  const answer=nvidiaChat({prompt:"hash",conversation_id:randomUUID(),execute_tools:true,execution_id:"exec_"+randomUUID()},
    {env,memory:r.state.memory,session:r.session,fetch:async()=>{memory.state.failWrites=true;return Response.json({id:"FIXTURE_RESPONSE",model:env.NVIDIA_MODEL,choices:[{message:{content:null,tool_calls:[{id:"c",type:"function",function:{name:"osa_sha256",arguments:'{"text":"P1"}'}}]}}]});},
      dispatch:async input=>{tools++;const bundle=await executeUnified(input,"org_p1",r.registry);await r.state.rememberExecution(bundle,r.session);return bundle;}});
  await assert.rejects(answer,e=>e instanceof MemoryAccessError&&e.code==="MEMORY_WRITE_UNCONFIRMED"&&Boolean(e.execution_id));
  assert.equal(tools,1);assert.equal(r.state.runs.size,1);assert.equal(memory.documents.size,0);
});

test("P1 FIXTURE: adapter sprawdza readback, idempotencję i integralność pamięci",async()=>{
  const f=memoryFixture(),a=f.adapter(),scope={organization_id:"org_p1",project_id:"osa-proof",mission_id:"mission-p1"};
  const event=sealMemoryEvent({scope,kind:"VERIFIED_RUNTIME",verification_scope:"FIXTURE kontraktu",data:{execution_id:"exec_"+randomUUID()}});
  const first=await a.observe(event),again=await a.observe(event);assert.equal(first.receipt_sha256,again.receipt_sha256);assert.equal(f.documents.size,1);
  const read=await f.adapter().readEvent(scope,first.document_id);assert.equal(read.event.event_sha256,event.event_sha256);
  f.state.tamper=true;await assert.rejects(a.readEvent(scope,first.document_id));
  const before=f.state.requests;await assert.rejects(a.readEvent({...scope,project_id:"foreign"},first.document_id));assert.equal(f.state.requests,before);
});

test("P1 FIXTURE HTTP: istniejący podpisany cookie operatora wiąże dostęp z projektem pamięci",async()=>{
  const memory=memoryFixture(),origin="https://p1-operator.invalid",operatorToken="P1_SYNTHETIC_OPERATOR_1234567890123456789";
  const config={VERCEL:"1",VERCEL_ENV:"preview",OSA_AUTH_MODE:"session",OSA_OPERATOR_TOKEN:operatorToken,OSA_OPERATOR_ORGANIZATION_ID:"org_p1",OSA_OPERATOR_PROJECT_ID:"osa-proof",OSA_OPERATOR_ORIGIN:origin};
  const r=runtime(memory,config),server=createApiServer(r.registry,r.state);
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  try{
    const login=await fetch(base+"/auth/operator-login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({token:operatorToken})});
    assert.equal(login.status,200);const cookie=login.headers.get("set-cookie")!.split(";")[0];
    const status=await (await fetch(base+"/memory/status",{headers:{cookie}})).json();assert.equal(status.state,"AVAILABLE");
    assert.equal(status.brain_id,"brain_p1");assert.equal(status.persistence_verified,false);
    assert.equal((await (await fetch(base+"/memory/status",{headers:{cookie:cookie+"tampered"}})).json()).state,"ACCESS_REQUIRED");
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test("P1 FIXTURE HTTP: route API zachowuje tool_calls i zwraca potwierdzenie pamięci",async()=>{
  const memory=memoryFixture(),r=runtime(memory,env),server=createApiServer(r.registry,r.state),original=globalThis.fetch;
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),"https://integrate.api.nvidia.com/v1/chat/completions");calls++;
    assert.equal(JSON.parse(String(init?.body)).tools[0].function.name,"osa_sha256");
    return Response.json({id:"FIXTURE_RESPONSE",model:env.NVIDIA_MODEL,choices:[{message:{content:null,tool_calls:[{id:"FIXTURE_CALL",type:"function",function:{name:"osa_sha256",arguments:'{"text":"HTTP P1"}'}}]}}]});
  };
  try{
    const response=await original(base+"/nvidia/fleet-chat",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+r.session.token},body:JSON.stringify({prompt:"Oblicz hash",conversation_id:randomUUID(),execute_tools:true,execution_id:"exec_"+randomUUID()})});
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,"TOOL_EXECUTED");assert.ok(body.bundle.memory_write.receipt_sha256);
    assert.equal(verifyUnifiedBundle(body.bundle).ok,true);assert.equal(calls,1);assert.equal(memory.documents.size,1);
  }finally{globalThis.fetch=original;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test("P1 FIXTURE: potwierdzony remember pozostaje dostępny po błędzie modelu",async()=>{
  const memory=memoryFixture(),r=runtime(memory);let calls=0;
  await assert.rejects(nvidiaChat({prompt:"Zapisz syntetyczny stan P1",remember:true,conversation_id:randomUUID()},
    {env:{...env,OSA_MODEL_QUOTA_SCOPE:"p1-confirmed-remember"},memory:r.state.memory,session:r.session,fetch:async()=>{calls++;return new Response("secret",{status:503});}}),
    e=>e instanceof Error&&"code" in e&&e.code==="NVIDIA_REJECTED"&&"memory_write" in e&&Boolean((e.memory_write as {receipt_sha256:string}).receipt_sha256));
  assert.equal(memory.documents.size,1);assert.equal(calls,1);
});

test("P1 FIXTURE: awaria magazynu i obcy scope nie zapisują pamięci ani pozornego sukcesu",async()=>{
  const memory=memoryFixture(),pair=generateKeyPairSync("ed25519"),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response("secret storage",{status:503});};
  try{
    const r=runtime(memory,{OSA_STORAGE_URL:"https://p1-contract.supabase.co/functions/v1/osa-proof-storage",OSA_STORAGE_PRIVATE_KEY_B64:pair.privateKey.export({format:"der",type:"pkcs8"}).toString("base64")});
    const request={message:"Oblicz SHA-256 tekstu: P1",execution_id:"exec_"+randomUUID()};
    const foreign=await executeUnified(request,"foreign",r.registry);
    await assert.rejects(r.state.rememberExecution(foreign,r.session),e=>e instanceof MemoryAccessError&&e.status===403);
    assert.equal(calls,0);
    const own=await executeUnified({...request,execution_id:"exec_"+randomUUID()},"org_p1",r.registry);
    await assert.rejects(r.state.rememberExecution(own,r.session),e=>e instanceof StorageError);
    assert.equal(calls,1);assert.equal(memory.documents.size,0);assert.equal(r.state.runs.size,0);
  }finally{globalThis.fetch=original;}
});

test("P1 FIXTURE: sekret modelu w kontekście pamięci nie dociera do dostawcy",async()=>{
  const f=memoryFixture(),r=runtime(f);let calls=0;
  f.documents.set("doc_secret",{documentId:"doc_secret",revision:1,content:env.NVIDIA_API_KEY,contentHash:"f".repeat(64)});
  await assert.rejects(nvidiaChat({prompt:"Odczytaj kontekst",conversation_id:randomUUID()},
    {env:{...env,OSA_MODEL_QUOTA_SCOPE:"p1-secret-denial"},memory:r.state.memory,session:r.session,fetch:async()=>{calls++;throw Error();}}),
    e=>e instanceof NvidiaError&&e.code==="SECRET_IN_PROMPT");
  assert.equal(calls,0);
});
