import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {createServer,type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {ApiState,createApiServer} from "../apps/api/src";
import {createDevExecution} from "../apps/api/src/server";
import {operatorAccessStatus,operatorSession} from "../apps/api/src/operator-access";
import {handleNvidiaRequest,nvidiaComplete,nvidiaCostGate} from "../apps/api/src/nvidia";
import {takeModelQuota,MODEL_QUOTA_LUA} from "../apps/api/src/model-quota";
import {executeUnified,verifyUnifiedBundle} from "../apps/api/src/unified";

const origin="https://preview.osa.invalid";
function config():NodeJS.ProcessEnv {return {VERCEL:"1",OSA_AUTH_MODE:"open",OSA_OPERATOR_TOKEN:randomBytes(32).toString("base64url"),
  OSA_OPERATOR_ORGANIZATION_ID:"org_dev_local",OSA_OPERATOR_PROJECT_ID:"osa-proof",OSA_OPERATOR_ORIGIN:origin};}
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));return "http://127.0.0.1:"+(server.address() as AddressInfo).port;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
async function login(base:string,env:NodeJS.ProcessEnv){const r=await fetch(base+"/auth/operator-login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({token:env.OSA_OPERATOR_TOKEN})});assert.equal(r.status,200);return r.headers.get("set-cookie")!.split(";")[0];}

test("chmura: open i dev-login nie obchodzą ochrony żadnego API ani modelu",async()=>{
  const env=config(),runtime=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  const server=createApiServer(runtime.registry,new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,env));
  const base=await listen(server);
  try{
    for(const path of ["/nvidia/status","/build/status","/organizations","/permissions","/queue","/datasets","/knowledge","/secrets","/runs/unknown/evidence","/missions/unknown","/build/workspace"])
      assert.equal((await fetch(base+path)).status,401,path);
    for(const path of ["/nvidia/chat","/nvidia/fleet-chat","/unified/execute","/teams","/missions"])
      assert.equal((await fetch(base+path,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({prompt:"test"})})).status,401,path);
    assert.equal((await fetch(base+"/auth/dev-login",{method:"POST",body:JSON.stringify({display_name:"forged"})})).status,403);
    const access=await (await fetch(base+"/auth/access")).json() as {required:boolean;authenticated:boolean};
    assert.equal(access.required,true);assert.equal(access.authenticated,false);assert.equal((access as {scope?:unknown}).scope,null);
  }finally{await close(server);}
});
test("chmura: sesja działa w nowej instancji; cookie, pochodzenie, termin i zakres są weryfikowane",async()=>{
  const env=config(),runtime=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  const servers=[0,1].map(()=>createApiServer(runtime.registry,new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,env)));
  const [a,b]=await Promise.all(servers.map(listen));
  try{
    const cookie=await login(a,env);
    assert.ok(!cookie.includes(env.OSA_OPERATOR_TOKEN!));
    assert.equal((await fetch(b+"/build/status",{headers:{cookie}})).status,200);
    const access=await (await fetch(b+"/auth/access",{headers:{cookie}})).json();assert.deepEqual(access.scope,{organization_id:"org_dev_local",project_id:"osa-proof"});
    assert.equal((await fetch(b+"/build/status",{headers:{cookie:cookie+"forged"}})).status,401);
    assert.equal((await fetch(b+"/build/status",{headers:{authorization:"Bearer "+env.OSA_OPERATOR_TOKEN}})).status,401,"Bootstrap key is not an API bearer");
    assert.equal((await fetch(b+"/unified/execute",{method:"POST",headers:{cookie,origin:"https://attacker.invalid","content-type":"application/json"},body:"{}"})).status,403);
    const req={headers:{cookie}} as Parameters<typeof operatorSession>[0];
    assert.ok(operatorSession(req,env));
    assert.equal(operatorSession(req,env,Date.now()+31*60000),undefined);
    assert.equal(operatorSession(req,{...env,OSA_OPERATOR_PROJECT_ID:"foreign"}),undefined);
    assert.equal(operatorSession(req,{...env,OSA_OPERATOR_ORIGIN:"https://other.invalid"}),undefined);
    assert.equal(operatorSession(req,{...env,OSA_OPERATOR_TOKEN:randomBytes(32).toString("base64url")}),undefined);
    const graph={organization_id:"org_dev_local",project_id:"foreign",team_id:"denied",version:"1",agents:[{agent_id:"a",role:"a",executor_ref:"dev.planner.v1"}],edges:[]};
    assert.equal((await fetch(b+"/teams",{method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify(graph)})).status,403);
    assert.equal((await fetch(b+"/unified/execute",{method:"POST",headers:{cookie,origin,"content-type":"application/json"},body:JSON.stringify({message:"forge",execution_id:"exec_"+randomUUID(),tool:"osa.crypto.sha256.v1"})})).status,403);
  }finally{await Promise.all(servers.map(close));}
});
test("chmura: brak konfiguracji operatora zatrzymuje żądanie mimo OSA_AUTH_MODE=open",async()=>{
  const runtime=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  const server=createApiServer(runtime.registry,new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,{VERCEL:"1"}));
  const base=await listen(server);
  try{const r=await fetch(base+"/nvidia/status");assert.equal(r.status,503);assert.equal((await r.json()).code,"OPERATOR_ACCESS_NOT_CONFIGURED");}finally{await close(server);}
});
test("Preview open: panel i natywny dowód działają bez operatora, model nadal wymaga autoryzacji",async()=>{
  const env={VERCEL:"1",VERCEL_ENV:"preview",OSA_AUTH_MODE:"open"};
  const runtime=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
  const server=createApiServer(runtime.registry,new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,env),runtime.description);
  const base=await listen(server);
  try{
    const access=await (await fetch(base+"/auth/access")).json();
    assert.deepEqual(access,{required:false,configured:false,mode:"OPEN_PREVIEW",authenticated:false,scope:null});
    const status=await fetch(base+"/build/status");assert.equal(status.status,200);assert.equal((await status.json()).auth_mode,"open");
    assert.equal((await fetch(base+"/nvidia/status")).status,200);
    const json={"content-type":"application/json"};
    const result=await fetch(base+"/unified/execute",{method:"POST",headers:json,body:JSON.stringify({message:"Oblicz SHA-256 tekstu: OSA Proof",execution_id:"exec_"+randomUUID()})});
    assert.equal(result.status,200);const bundle=await result.json();assert.equal(bundle.status,"EXECUTED");assert.equal(verifyUnifiedBundle(bundle).ok,true);
    const verified=await fetch(base+"/unified/verify",{method:"POST",headers:json,body:JSON.stringify(bundle)});
    assert.equal(verified.status,200);assert.equal((await verified.json()).ok,true);
    for(const path of ["/nvidia/chat","/nvidia/fleet-chat"]){
      const denied=await fetch(base+path,{method:"POST",headers:json,body:JSON.stringify({prompt:"test"})});
      assert.equal(denied.status,401);assert.equal((await denied.json()).code,"MODEL_OPERATOR_SESSION_REQUIRED");
    }
    assert.equal((await fetch(base+"/unified/execute",{method:"POST",headers:json,body:JSON.stringify({tool:"osa.crypto.sha256.v1"})})).status,403);
    assert.equal((await fetch(base+"/web3/execute",{method:"POST",headers:json,body:"{}"})).status,403);
  }finally{await close(server);}
});
test("wyjątek bez logowania dotyczy wyłącznie jawnego Vercel Preview open",()=>{
  for(const env of [
    {VERCEL:"1",VERCEL_ENV:"production",OSA_AUTH_MODE:"open"},
    {VERCEL:"1",OSA_AUTH_MODE:"open"},
    {VERCEL:"1",VERCEL_ENV:"development",OSA_AUTH_MODE:"open"},
    {NODE_ENV:"production",VERCEL_ENV:"preview",OSA_AUTH_MODE:"open"},
    {VERCEL:"1",VERCEL_ENV:"preview",OSA_AUTH_MODE:"session"}
  ])assert.equal(operatorAccessStatus(env).required,true);
});
test("koszty: brak polityki, zgody, modelu lub świeżej weryfikacji blokuje wywołanie",async()=>{
  const env={VERCEL:"1",NVIDIA_API_KEY:randomBytes(32).toString("hex"),NVIDIA_MODEL:"nvidia/test-model"};
  assert.throws(()=>nvidiaCostGate(env),/zerowych kosztów/);
  const paid={...env,OSA_ZERO_COST_ONLY:"true",OSA_NVIDIA_FREE_TIER_ACK:"true",OSA_NVIDIA_FREE_MODELS:"nvidia/test-model",OSA_NVIDIA_FREE_UNTIL:new Date(Date.now()+3600000).toISOString()};
  assert.doesNotThrow(()=>nvidiaCostGate(paid));
  for(const override of [{OSA_NVIDIA_FREE_TIER_ACK:"false"},{OSA_NVIDIA_FREE_MODELS:"other/model"},{OSA_NVIDIA_FREE_UNTIL:new Date(0).toISOString()},{OSA_NVIDIA_FREE_UNTIL:new Date(Date.now()+48*3600000).toISOString()}]){
    let network=0;await assert.rejects(nvidiaComplete("test",{...paid,...override},(async()=>{network++;throw Error("unexpected");}) as typeof fetch));assert.equal(network,0);
  }
  let network=0;await assert.rejects(takeModelQuota(paid,randomUUID(),(async()=>{network++;throw Error("unexpected");}) as typeof fetch),/współdzielonego/);assert.equal(network,0);
});
test("wspólny limit: jedna atomowa komenda, brak fallbacku po odmowie lub awarii Redis (transport symulowany)",async()=>{
  const env={...config(),OSA_QUOTA_REDIS_REST_URL:"https://quota.invalid",OSA_QUOTA_REDIS_REST_TOKEN:randomBytes(32).toString("hex")};
  for(const result of [0,"1",null])await assert.rejects(takeModelQuota(env,randomUUID(),(async()=>new Response(JSON.stringify({result}))) as typeof fetch));
  await assert.rejects(takeModelQuota(env,randomUUID(),(async()=>{throw Error(env.OSA_QUOTA_REDIS_REST_TOKEN);}) as typeof fetch),error=>error instanceof Error&&!error.message.includes(env.OSA_QUOTA_REDIS_REST_TOKEN));
  const ids:string[]=[];
  const fake=(async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body[0],"EVAL");assert.equal(body[1],MODEL_QUOTA_LUA);assert.equal(body[2],"1");ids.push(body[4]);return new Response('{"result":1}');}) as typeof fetch;
  await Promise.all([takeModelQuota(env,randomUUID(),fake),takeModelQuota(env,randomUUID(),fake)]);assert.equal(new Set(ids).size,2);
});
test("tool_calls: symulowany dostawca → prawdziwy Runtime → receipt; niedozwolone narzędzie nie dociera do Runtime",async()=>{
  const runtime=createDevExecution({OSA_EXECUTION_MODE:"fixture"});let dispatches=0;
  const env={NVIDIA_API_KEY:randomBytes(32).toString("hex"),NVIDIA_MODEL:"nvidia/test-model"};
  let denied=false;
  const fake=(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.tools[0].function.name,"osa_sha256");
    return new Response(JSON.stringify({id:"SIMULATED_PROVIDER_RESPONSE",model:"nvidia/test-model",choices:[{finish_reason:"tool_calls",message:{content:null,tool_calls:[{id:"simulated-call",type:"function",function:{name:denied?"shell_exec":"osa_sha256",arguments:JSON.stringify({text:"OSA Proof"})}}]}}]}));
  }) as typeof fetch;
  const server=createServer((req,res)=>void handleNvidiaRequest(req,res,"/nvidia/fleet-chat",{env,fetch:fake,dispatch:async input=>{dispatches++;return executeUnified(input,"org_dev_local",runtime.registry);}}));
  const base=await listen(server),execution_id="exec_"+randomUUID();
  try{
    const post=()=>fetch(base,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:"Oblicz digest",agent:"runtime",execute_tools:true,execution_id})});
    const r=await post();assert.equal(r.status,200);const answer=await r.json();
    assert.equal(answer.status,"TOOL_EXECUTED");assert.equal(answer.bundle.routing,"MODEL_TOOL_CALL");assert.equal(answer.bundle.execution_id,execution_id);
    assert.equal(verifyUnifiedBundle(answer.bundle).ok,true);assert.ok(answer.bundle.run.events.every((e:{execution_id:string})=>e.execution_id===execution_id));
    assert.equal(answer.bundle.run.final_output.sha256,createHash("sha256").update("OSA Proof").digest("hex"));
    denied=true;const blocked=await post();assert.equal(blocked.status,502);assert.equal((await blocked.json()).code,"NVIDIA_TOOL_NOT_ALLOWED");assert.equal(dispatches,1);
  }finally{await close(server);}
});
test("HTTP NVIDIA: klucz klienta i obcy model są odrzucane przed dostępem do sieci",async()=>{
  let network=0;
  const env={NVIDIA_API_KEY:randomBytes(32).toString("hex"),NVIDIA_MODEL:"nvidia/allowed"};
  const server=createServer((req,res)=>void handleNvidiaRequest(req,res,req.url!,{env,fetch:(async()=>{network++;throw Error("unexpected");}) as typeof fetch}));
  const base=await listen(server);
  try{
    for(const path of ["/nvidia/chat","/nvidia/fleet-chat"]){
      const post=(body:unknown)=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      assert.equal((await post({prompt:"test",apiKey:"client-input"})).status,400);
      assert.equal((await post({prompt:"test",model:"other/model"})).status,403);
    }
    assert.equal(network,0);
  }finally{await close(server);}
});
