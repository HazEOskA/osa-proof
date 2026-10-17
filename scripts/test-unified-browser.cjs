"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {chromium,devices}=require("playwright");
const root=path.resolve(__dirname,".."),out=path.join(root,"artifacts","osa-native-chat-e2e");
fs.mkdirSync(out,{recursive:true});
const base="http://127.0.0.1:3199";
const children=[];
async function ready(url){for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,300));}throw Error("SERVER_NOT_READY "+url);}
async function main(){
  const log=fs.openSync(path.join(out,"local-runtime.log"),"w");
  children.push(spawn(process.execPath,["scripts/unified-e2e-server.cjs"],{cwd:root,stdio:["ignore",log,log],env:{...process.env,OSA_E2E_API_PORT:"3199",OSA_EXECUTION_MODE:"fixture",NVIDIA_API_KEY:"",OPENROUTER_API_KEY:""}}));
  await ready(base+"/api/build/status");
  const access=await (await fetch(base+"/api/auth/access")).json();
  assert.equal(access.required,false);assert.equal(access.mode,"OPEN_PRODUCTION");assert.equal(access.authenticated,false);
  const browser=await chromium.launch({executablePath:process.env.OSA_CHROMIUM_EXECUTABLE||undefined,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  const report=[];
  try {
    for(const [name,width,height] of [["android-320",320,640],["android-390",390,844],["desktop",1440,900]]){
      const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce",...(width<768?{isMobile:true,hasTouch:true,userAgent:devices["Pixel 7"].userAgent}:{})});
      const failures=[],requests=[];page.on("pageerror",e=>failures.push(e.message));
      page.on("request",r=>{if(r.url().includes("/api/unified/"))requests.push({method:r.method(),url:r.url()});});
      const loaded=await page.goto(base,{waitUntil:"domcontentloaded"});
      assert.equal(loaded?.status(),200);
      const home=page.locator('section[aria-label="Uruchamianie"]');
      await home.waitFor({state:"visible"});
      assert.equal(await page.getByRole("heading",{name:"Dostęp operatora"}).count(),0);
      assert.equal(await page.getByTestId("osa-native-chat").count(),0,"Framework Home must load first");
      await home.getByRole("button",{name:"Czat floty agentów",exact:true}).click();
      await page.getByTestId("osa-native-chat").waitFor({state:"visible"});
      assert.equal(await page.locator('iframe[title="Jeverson Chat"]').count(),0);
      const input="OSA Unified Runtime V1";
      const expectedHash=crypto.createHash("sha256").update(input).digest("hex");
      await page.getByTestId("osa-composer").fill("Oblicz SHA-256 tekstu: "+input);
      await page.getByTestId("osa-send").click();
      const answer=page.getByTestId("osa-message").filter({hasText:expectedHash});
      await answer.waitFor({state:"visible",timeout:25000});
      assert.match(await answer.innerText(),/ZWERYFIKOWANO/);
      const execution=await answer.innerText();
      assert.match(execution,/exec_[a-f0-9-]{36}/);
      assert.equal(requests.filter(r=>r.url.endsWith("/api/unified/execute")).length,1);
      assert.equal(requests.filter(r=>r.url.endsWith("/api/unified/verify")).length,1);
      const bundle=await page.evaluate(()=>JSON.parse(localStorage.getItem("osa.execution.bundle.v1")));
      assert.equal(require("../dist/apps/api/src/unified.js").verifyUnifiedBundle(bundle).ok,true);
      fs.writeFileSync(path.join(out,name+"-bundle.json"),JSON.stringify(bundle,null,2));
      await page.screenshot({path:path.join(out,name+"-chat.png"),fullPage:true});
      await page.getByRole("button",{name:"Inspektor"}).click();
      const inspect=page.getByTestId("osa-inspector");
      await inspect.waitFor({state:"visible"});
      assert.match(await inspect.innerText(),/ZWERYFIKOWANO/);
      assert.match(await inspect.innerText(),/Materiały: [1-9]/);
      await inspect.getByRole("button",{name:/Odtwarzanie/}).click();
      const slider=page.getByRole("slider",{name:"Pozycja odtwarzania"});
      await slider.waitFor({state:"visible"});await slider.focus();await slider.press("End");
      assert.equal(await slider.inputValue(),String(bundle.run.events.length));
      await page.getByText(`krok ${bundle.run.events.length} / ${bundle.run.events.length}`,{exact:true}).waitFor({state:"visible"});
      assert.match(await page.locator("main").innerText(),/UKOŃCZONO/);
      await page.screenshot({path:path.join(out,name+"-replay.png"),fullPage:true});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      if(overflow>1){const elements=await page.evaluate(()=>Array.from(document.querySelectorAll("*")).filter(el=>{const r=el.getBoundingClientRect();return r.right>innerWidth+1&&r.width>0;}).slice(0,12).map(el=>({tag:el.tagName,classes:String(el.className).slice(0,110),text:(el.textContent||"").slice(0,70),right:Math.round(el.getBoundingClientRect().right)})));console.error(JSON.stringify({name,overflow,elements}));}
      assert.ok(overflow<=1,"Native Runtime chat overflow: "+overflow);
      assert.deepEqual(failures,[]);
      await page.reload({waitUntil:"domcontentloaded"});
      await page.waitForFunction(id=>document.body.innerText.includes(id),execution.match(/exec_[a-f0-9-]{36}/)[0]);
      assert.match(await page.locator("body").innerText(),/Zweryfikowany zapis lokalny/i);
      await page.evaluate(()=>{const key="osa.execution.bundle.v1",b=JSON.parse(localStorage.getItem(key));b.run.evidence[0].data.status="TAMPERED";localStorage.setItem(key,JSON.stringify(b));});
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByText("Zapisany lokalnie dowód nie przeszedł weryfikacji lub API jest niedostępne.",{exact:false}).first().waitFor({state:"visible"});
      const row={name,android_emulation:width<768,result:"PASS",access_mode:access.mode,login_required:false,refresh_restored:true,tampered_restore_rejected:true,cloud_persistence:false,execution_id:execution.match(/exec_[a-f0-9-]{36}/)[0],crypto_sha256:expectedHash,real_runtime:true,verified_receipt:true,replay_ui:true,replay_to_final_event:true,provider_model_tool_call:"NOT_TESTED",paid_calls:0};
      console.log(JSON.stringify(row));report.push(row);await page.close();
    }
  }finally{await browser.close();}
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const child of children)child.kill("SIGTERM");});
