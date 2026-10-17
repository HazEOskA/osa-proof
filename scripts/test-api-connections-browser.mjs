// UI contract with explicitly controlled metadata/save responses. No real provider call.
import assert from "node:assert/strict";
import fs from "node:fs";
import {randomBytes} from "node:crypto";
import {chromium,devices} from "playwright";
const base=process.env.OSA_UI_TEST_BASE||"http://127.0.0.1:3100";
fs.mkdirSync("artifacts/osa-api-connections",{recursive:true});
const browser=await chromium.launch({executablePath:process.env.OSA_CHROMIUM_EXECUTABLE||undefined,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:width===320?640:844},reducedMotion:"reduce",...(width<768?{isMobile:true,hasTouch:true,userAgent:devices["Pixel 7"].userAgent}:{})});
  let saved=false,writes=0,modelCalls=0;const canary=randomBytes(24).toString("hex"),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("request",r=>{if(/\/(nvidia\/fleet-chat|models\/chat)$/.test(r.url()))modelCalls++;});
  await page.route("**/api/models/status",r=>r.fulfill({json:{storage:"PROCESS_MEMORY",durable:false,key_entry_available:true,providers:["nvidia","openrouter","openai","anthropic","compatible"].map(id=>({id,name:id,configured:saved&&id==="openrouter",model:id==="openrouter"?"openrouter/free":"",source:saved&&id==="openrouter"?"PRIVATE_SERVER_STORE":"NONE"}))}}));
  await page.route("**/api/models/connections",r=>{
    const v=r.request().postDataJSON();assert.equal(v.provider,"openrouter");assert.equal(v.model,"openrouter/free");assert.ok(v.apiKey===canary);assert.equal(v.allowPaid,false);saved=true;writes++;return r.fulfill({json:{saved:true,provider:v.provider,model:v.model,storage:"PROCESS_MEMORY"}});
  });
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
  const picker=page.getByRole("button",{name:"Wybierz agenta"});assert.match(await picker.innerText(),/Jeff/);
  await picker.click();await page.getByTestId("osa-agent-picker").getByRole("button",{name:/Hermes/}).click();assert.match(await picker.innerText(),/Hermes/);
  await page.getByRole("combobox",{name:"Wybierz model"}).selectOption("openrouter");
  await page.getByRole("button",{name:"Połączenia API",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Połączenia API",exact:true});await dialog.waitFor();
  const form=page.getByTestId("osa-api-connections");
  assert.deepEqual(await form.getByRole("combobox",{name:"Dostawca API"}).locator("option").evaluateAll(xs=>xs.map(x=>x.value)),["nvidia","openrouter","openai","anthropic","compatible"]);
  await form.getByLabel("Klucz API",{exact:true}).fill(canary);
  assert.equal(await form.getByLabel("Klucz API",{exact:true}).getAttribute("type"),"password");
  await form.getByRole("button",{name:"Połącz w sesji serwera",exact:true}).click();
  await form.getByRole("status").filter({hasText:"Połączono w bieżącej sesji serwera"}).waitFor();
  assert.equal(await form.getByLabel("Klucz API",{exact:true}).inputValue(),"");
  assert.ok(!(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).includes(canary));
  assert.ok(!(await form.innerText()).includes(canary));assert.equal(writes,1);assert.equal(modelCalls,0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1);assert.deepEqual(errors,[]);
  await page.screenshot({path:`artifacts/osa-api-connections/${width}.png`,fullPage:true});
  await page.getByRole("button",{name:"Zamknij połączenia API"}).click();
  await page.reload({waitUntil:"domcontentloaded"});await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
  assert.equal(await page.getByRole("combobox",{name:"Wybierz model"}).inputValue(),"openrouter");assert.match(await picker.innerText(),/Hermes/);
  console.log(JSON.stringify({width,api_form:"PASS",jeff:true,hermes:true,openrouter_selection_restored:true,no_frontend_key_storage:true,metadata_and_save:"CONTROLLED_UI_CONTRACT",real_provider:"NOT_TESTED",model_calls:0}));await page.close();
 }
}finally{await browser.close();}
