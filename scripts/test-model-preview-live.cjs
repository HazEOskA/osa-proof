"use strict";
// Dwa rzeczywiste wywołania NVIDIA w całym odbiorze: pierwsze HTTP, drugie tutaj.
// Ten skrypt nie stosuje route.fulfill, retry ani deterministycznego wyboru narzędzia.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium,devices}=require('playwright');
const {verifyUnifiedBundle}=require('../dist/apps/api/src/unified');
const base=process.env.OSA_LIVE_PREVIEW_BASE;if(!base||!/^https:\/\/osa-proof-[a-z0-9-]+\.vercel\.app$/.test(base))throw Error('Wymagany dokładny adres Preview');
const out=path.resolve('artifacts/finalization-three');fs.mkdirSync(out,{recursive:true});
const marker=path.join(out,'model-request-2-started.json');
(async()=>{const browser=await chromium.launch({executablePath:process.env.OSA_CHROMIUM_EXECUTABLE,headless:true,proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined,args:['--no-sandbox','--disable-dev-shm-usage']});let bundle;
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent,ignoreHTTPSErrors:true,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('section[aria-label="Uruchamianie"]').getByRole('button',{name:'Czat floty agentów',exact:true}).click();
  await page.getByRole('combobox',{name:'Wybierz model'}).selectOption('nvidia');await page.getByText('NVIDIA · GOTOWE',{exact:true}).waitFor();
  await page.getByRole('checkbox').check();await page.getByTestId('osa-composer').fill('Wywołaj narzędzie osa_sha256 z argumentem text równym dokładnie "OSA Proof v0.1.0". Nie obliczaj skrótu samodzielnie.');
  fs.writeFileSync(marker,JSON.stringify({attempt:2,maximum_requests:2,preview:base,started_at:new Date().toISOString()}),{flag:'wx'});
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/nvidia/fleet-chat')&&r.request().method()==='POST',{timeout:60000});
  await page.getByTestId('osa-send').click();const response=await responsePromise;const data=await response.json();
  fs.writeFileSync(path.join(out,'nvidia-preview-attempt-2.json'),JSON.stringify({preview:base,http_status:response.status(),attempt:2,response:data},null,2));
  assert.equal(response.status(),200);assert.equal(data.status,'TOOL_EXECUTED');bundle=data.bundle;assert.equal(bundle.routing,'MODEL_TOOL_CALL');assert.equal(bundle.provider,'nvidia');assert.equal(verifyUnifiedBundle(bundle).ok,true);
  const hash=crypto.createHash('sha256').update('OSA Proof v0.1.0').digest('hex');assert.equal(bundle.run.final_output.sha256,hash);assert.ok(data.provider_response_id);assert.equal(data.model,'nvidia/nemotron-3-super-120b-a12b');
  await page.getByTestId('osa-message').filter({hasText:hash}).waitFor({state:'visible',timeout:20000});assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,'model-chat-390.png'),fullPage:true});fs.writeFileSync(path.join(out,'model-ui-bundle.json'),JSON.stringify(bundle,null,2));
  console.log(JSON.stringify({phase:'REAL_MODEL_UI',width:390,result:'PASS',execution_id:bundle.execution_id,provider_response_id:data.provider_response_id,routing:bundle.routing,paid_fallback:false}));await page.close();
  const reports=[];
  for(const width of [320,390,1440]){
   const context=await browser.newContext({viewport:{width,height:width===320?640:900},ignoreHTTPSErrors:true,reducedMotion:'reduce',...(width<768?{isMobile:true,hasTouch:true,userAgent:devices['Pixel 7'].userAgent}:{})});assert.deepEqual((await context.storageState()).origins,[]);
   const p=await context.newPage();let modelCalls=0,cloudReads=0;p.on('request',r=>{if(r.url().endsWith('/api/nvidia/fleet-chat')||r.url().endsWith('/api/models/chat'))modelCalls++;if(r.url().includes('/api/unified/executions/'))cloudReads++;});
   await p.goto(base+'?execution_id='+bundle.execution_id,{waitUntil:'domcontentloaded'});await p.locator('section[aria-label="Uruchamianie"]').getByRole('button',{name:'Czat floty agentów',exact:true}).click();
   await p.getByTestId('osa-message').filter({hasText:'Przywrócono z trwałego zapisu Postgres'}).waitFor({state:'visible',timeout:30000});
   await p.getByRole('button',{name:'Inspektor',exact:true}).click();const inspector=p.getByTestId('osa-inspector');await inspector.waitFor();assert.match(await inspector.innerText(),/ZWERYFIKOWANO/);
   await inspector.getByRole('button',{name:/Odtwarzanie/}).click();const slider=p.getByRole('slider',{name:'Pozycja odtwarzania'});await slider.waitFor();await slider.focus();await slider.press('End');assert.equal(await slider.inputValue(),String(bundle.run.events.length));await p.getByText(`krok ${bundle.run.events.length} / ${bundle.run.events.length}`,{exact:true}).waitFor();
   await p.screenshot({path:path.join(out,'model-replay-'+width+'.png'),fullPage:true});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(id=>document.body.innerText.includes(id),bundle.execution_id);assert.equal(modelCalls,0);assert.ok(cloudReads>=1);
   const row={width,result:'PASS',execution_id:bundle.execution_id,fresh_browser_context:true,postgres_read:true,independent_browser_verifier:true,replay_to_last_event:true,refresh_restored:true,model_calls_during_restore:0};reports.push(row);console.log(JSON.stringify(row));await context.close();
  }
  fs.writeFileSync(path.join(out,'model-browser-results.json'),JSON.stringify(reports,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(JSON.stringify({result:'FAIL',message:e.message}));process.exitCode=1;});
