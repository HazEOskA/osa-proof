"use strict";
// Rzeczywisty formularz i serwerowy Postgres. Losowy znacznik, bez klucza dostawcy i wywołań modelu.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {chromium,devices}=require('playwright');
const base=process.env.OSA_DEPLOYED_BASE;
if(!base||!/^https:\/\/osa-proof(?:-[a-z0-9-]+)?\.vercel\.app$/.test(base))throw Error('Wymagany dokładny adres OSA Proof');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.OSA_CHROMIUM_EXECUTABLE,headless:true,proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent,ignoreHTTPSErrors:true,reducedMotion:'reduce'});
 const canary='canary_'+randomBytes(24).toString('hex');let saved=false,modelCalls=0;
 await context.route(/\/api\/(?:nvidia\/(?:fleet-chat|chat)|models\/chat)$/,r=>{modelCalls++;return r.abort();});
 try{
  const page=await context.newPage();await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('section[aria-label="Uruchamianie"]').getByRole('button',{name:'Czat floty agentów',exact:true}).click();
  await page.getByRole('button',{name:'Połączenia API',exact:true}).click();const form=page.getByTestId('osa-api-connections');
  await form.getByRole('combobox',{name:'Dostawca API'}).selectOption('openrouter');await form.getByLabel('Klucz API',{exact:true}).fill(canary);
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/models/connections')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'Zapisz połączenie na serwerze',exact:true}).click();const response=await responsePromise;assert.equal(response.status(),200);saved=true;
  const save=await response.json();assert.equal(save.storage,'DURABLE_SERVER_ENCRYPTED');assert.ok(!JSON.stringify(save).includes(canary));
  await form.getByRole('status').filter({hasText:'Połączenie zapisane na serwerze'}).waitFor();assert.equal(await form.getByLabel('Klucz API',{exact:true}).inputValue(),'');
  assert.ok(!(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).includes(canary));assert.ok(!(await page.locator('body').innerText()).includes(canary));
  const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name==='__Host-osa-connections'&&c.httpOnly&&c.secure&&c.sameSite==='Strict'));
  const fresh=await browser.newContext({ignoreHTTPSErrors:true});try{await fresh.addCookies(cookies);const r=await fresh.request.get(base+'/api/models/status');assert.equal(r.status(),200);const status=await r.json();assert.equal(status.storage,'DURABLE_SERVER_ENCRYPTED');assert.equal(status.providers.find(p=>p.id==='openrouter').source,'PRIVATE_SERVER_STORE');assert.ok(!JSON.stringify(status).includes(canary));}finally{await fresh.close();}
  const foreign=await browser.newContext({ignoreHTTPSErrors:true});try{const r=await foreign.request.get(base+'/api/models/status');assert.notEqual((await r.json()).providers.find(p=>p.id==='openrouter').source,'PRIVATE_SERVER_STORE');}finally{await foreign.close();}
  const denied=await context.request.post(base+'/api/models/connections/delete',{headers:{origin:'https://example.invalid'},data:{provider:'openrouter'}});assert.equal(denied.status(),403);
  const removed=await context.request.post(base+'/api/models/connections/delete',{headers:{origin:base},data:{provider:'openrouter'}});assert.equal(removed.status(),200);saved=false;
  const after=await context.request.get(base+'/api/models/status');assert.notEqual((await after.json()).providers.find(p=>p.id==='openrouter').source,'PRIVATE_SERVER_STORE');assert.equal(modelCalls,0);
  const report={base,result:'PASS',width:390,real_form_and_server_store:true,canary_not_provider_key:true,storage:save.storage,new_context_with_owner_cookie:true,foreign_owner_denied:true,cross_origin_denied:true,no_frontend_key_storage:true,metadata_contains_no_key:true,cleanup:true,model_calls:0};
  const out=path.resolve('artifacts/finalization-three');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,base==='https://osa-proof-three.vercel.app'?'production-connections.json':'preview-connections.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(saved)await context.request.post(base+'/api/models/connections/delete',{headers:{origin:base},data:{provider:'openrouter'}}).catch(()=>{});await browser.close();}
})().catch(()=>{console.error(JSON.stringify({result:'FAIL',message:'Rzeczywisty test formularza lub trwałego połączenia nie przeszedł; nie wywołano modelu.'}));process.exitCode=1;});
