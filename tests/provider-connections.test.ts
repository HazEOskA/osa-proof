import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { ApiState, createApiServer } from "../apps/api/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import { ProviderVault, validateConnection, type ProviderConnection } from "../apps/api/src/provider-vault";
import { OpenAIProvider, AnthropicProvider } from "../packages/adapters/src";
import { completeProvider } from "../apps/api/src/provider-chat";

const key=()=>randomBytes(32).toString("hex");
async function listen(s:Server){await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));return "http://127.0.0.1:"+(s.address() as AddressInfo).port;}
async function close(s:Server){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}
test("połączenia: szyfrowany zapis przeżywa nową instancję, izoluje właściciela i odrzuca zmieniony plik",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"osa-provider-vault-"));
  const env={OSA_CONNECTIONS_DIR:dir,OSA_CONNECTIONS_ENCRYPTION_KEY:key()},owner=key(),secret=key();
  const connection:ProviderConnection={provider:"openrouter",model:"openrouter/free",apiKey:secret,allowPaid:false};
  try{
    await new ProviderVault(env).put("org:project",owner,connection);
    const loaded=await new ProviderVault(env).get("org:project",owner,"openrouter");assert.ok(loaded?.apiKey===secret);
    assert.equal(await new ProviderVault(env).get("other:project",owner,"openrouter"),undefined);
    assert.equal(await new ProviderVault(env).get("org:project",key(),"openrouter"),undefined);
    const file=join(dir,(await readdir(dir)).find(n=>n.endsWith(".enc"))!);const ciphertext=await readFile(file,"utf8");
    assert.ok(!ciphertext.includes(secret));assert.equal((await stat(file)).mode&0o777,0o600);
    await writeFile(file,ciphertext.slice(0,-4)+"AAAA");
    await assert.rejects(new ProviderVault(env).get("org:project",owner,"openrouter"),/integralności/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("połączenia: równoległy zapis dostawców zachowuje wszystkie klucze, a chmura nie używa pliku /tmp",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"osa-provider-concurrent-")),owner=key(),env={OSA_CONNECTIONS_DIR:dir};
  try{
    const values:ProviderConnection[]=["openai","anthropic","openrouter"].map(provider=>({provider:provider as ProviderConnection["provider"],model:"configured-model",apiKey:key(),allowPaid:true}));
    await Promise.all(values.map(c=>new ProviderVault(env).put("scope",owner,c)));
    for(const c of values)assert.ok((await new ProviderVault(env).get("scope",owner,c.provider))?.apiKey===c.apiKey);
    const cloud=new ProviderVault({...env,VERCEL:"1"});assert.equal(cloud.mode(),"PROCESS_MEMORY");assert.equal(cloud.ready(),true);
    await cloud.put("scope",owner,values[0]);assert.ok((await cloud.get("scope",owner,values[0].provider))?.apiKey===values[0].apiKey);
    assert.equal(cloud.ttl(),3600);assert.equal((await readdir(dir)).filter(n=>n.endsWith(".enc")).length,3,"cloud nie zapisuje dodatkowego pliku");
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("połączenia HTTP: własny klucz nie wraca do klienta; cookie i nowy serwer odtwarzają konfigurację; obcy klient nie ma dostępu",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"osa-provider-api-")),env={OSA_CONNECTIONS_DIR:dir,OSA_CONNECTIONS_ENCRYPTION_KEY:key()};
  const server=()=>createApiServer(new ExecutorRegistry(),new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,env));
  const a=server();let b:Server|undefined;
  try{
    const base=await listen(a),secret=key(),json={"content-type":"application/json",origin:base};
    const denied=await fetch(base+"/models/connections",{method:"POST",headers:{...json,origin:"https://foreign.invalid"},body:JSON.stringify({provider:"openai",model:"sample-model",apiKey:secret})});assert.equal(denied.status,403);
    const saved=await fetch(base+"/models/connections",{method:"POST",headers:json,body:JSON.stringify({provider:"openrouter",model:"openrouter/free",apiKey:secret})});assert.equal(saved.status,200);
    assert.ok(!(await saved.text()).includes(secret));const setCookie=saved.headers.get("set-cookie")!;assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.ok(!setCookie.includes(secret));const cookie=setCookie.split(";")[0];
    await close(a);b=server();const restarted=await listen(b);
    const mine=await fetch(restarted+"/models/status",{headers:{cookie}});const raw=await mine.text();assert.ok(!raw.includes(secret));const metadata=JSON.parse(raw);assert.equal(metadata.storage,"LOCAL_ENCRYPTED_FILE");assert.equal(metadata.providers.find((p:{id:string})=>p.id==="openrouter").source,"PRIVATE_SERVER_STORE");assert.ok(metadata.agents.some((a:{id:string})=>a.id==="jeff"));assert.ok(metadata.agents.some((a:{id:string})=>a.id==="hermes"));
    const other=await (await fetch(restarted+"/models/status")).json();assert.equal(other.providers.find((p:{id:string})=>p.id==="openrouter").configured,false);
    const forged=await fetch(restarted+"/models/chat",{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify({provider:"openrouter",prompt:"test",apiKey:secret})});assert.equal(forged.status,400);
    const removed=await fetch(restarted+"/models/connections/delete",{method:"POST",headers:{"content-type":"application/json",origin:restarted,cookie},body:JSON.stringify({provider:"openrouter"})});assert.equal(removed.status,200);
    const after=await (await fetch(restarted+"/models/status",{headers:{cookie}})).json();assert.equal(after.providers.find((p:{id:string})=>p.id==="openrouter").configured,false);
  }finally{if(a.listening)await close(a);if(b?.listening)await close(b);await rm(dir,{recursive:true,force:true});}
});
test("połączenia: adresy wewnętrzne i podmiana endpointu dostawcy są odrzucane",()=>{
  const input={provider:"compatible",model:"configured-model",apiKey:key()};
  for(const baseUrl of ["http://127.0.0.1","https://127.0.0.1","https://169.254.169.254","https://localhost","https://api.groq.com@attacker.invalid/v1","https://api.groq.com/v1?secret=yes"]){assert.throws(()=>validateConnection({...input,baseUrl}));}
  assert.throws(()=>validateConnection({...input,provider:"openai",baseUrl:"https://attacker.invalid"}));
  assert.equal(validateConnection({...input,baseUrl:"https://api.groq.com/openai/v1"}).baseUrl,"https://api.groq.com/openai/v1");
});
test("czat API: kontrakt zwykłego tekstu i historii OpenAI/Anthropic na kontrolowanym serwerze HTTP",async()=>{
  const captured:Array<{path:string;body:Record<string,unknown>}>=[];
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));
    captured.push({path:req.url!,body:JSON.parse(Buffer.concat(chunks).toString("utf8"))});
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify(req.url==="/v1/messages"?{id:"controlled-anthropic",model:"configured-model",stop_reason:"end_turn",content:[{type:"text",text:"Kontrolowany kontrakt HTTP"}]}:{id:"controlled-openai",model:"configured-model",choices:[{finish_reason:"stop",message:{content:"Kontrolowany kontrakt HTTP"}}]}));
  });
  try{
    const base=await listen(server),common={api_key:key(),model:"configured-model",base_url:base,timeout_ms:1000,max_tokens:128,max_retries:0,retry_base_ms:0};
    const request={system:"System",prompt:"Nowe pytanie",history:[{role:"user" as const,content:"Historia"},{role:"assistant" as const,content:"Poprzednia odpowiedź"}]};
    await new OpenAIProvider({...common,provider:"openai"},"/chat/completions","max_tokens").complete(request);
    await new AnthropicProvider({...common,provider:"anthropic"}).complete(request);
    assert.equal(captured[0].path,"/chat/completions");assert.equal(captured[1].path,"/v1/messages");
    assert.equal(captured[0].body.response_format,undefined);assert.equal(captured[1].body.output_config,undefined);
    assert.equal(captured[0].body.max_tokens,128);
    assert.deepEqual((captured[0].body.messages as unknown[]).slice(1,-1),request.history);
    assert.deepEqual((captured[1].body.messages as unknown[]).slice(0,-1),request.history);
    assert.equal(captured.length,2,"To kontrakt lokalny, bez połączenia z rzeczywistym dostawcą");
  }finally{await close(server);}
});
test("czat API: brak zgody na koszt i niedozwolone narzędzia są odrzucane przed transportem",async()=>{
  const connection:ProviderConnection={provider:"openai",model:"configured-model",apiKey:key(),allowPaid:false};
  await assert.rejects(completeProvider(connection,{prompt:"Pytanie",agent:"jeff"},{}),e=>(e as {code:string}).code==="PROVIDER_COST_CONSENT_REQUIRED");
  await assert.rejects(completeProvider({...connection,allowPaid:true},{prompt:"Pytanie",agent:"hermes",execute_tools:true},{}),e=>(e as {code:string}).code==="PROVIDER_TOOLS_UNSUPPORTED");
});
