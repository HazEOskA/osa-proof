"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,".."),out=path.join(root,"artifacts","osa-native-chat-e2e");
fs.mkdirSync(out,{recursive:true});
const base="http://127.0.0.1:3199";
const children=[];
async function ready(url){for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,300));}throw Error("SERVER_NOT_READY "+url);}
async function main(){
  const log=fs.openSync(path.join(out,"local-runtime.log"),"w");
  children.push(spawn(process.execPath,["scripts/unified-e2e-server.cjs"],{cwd:root,stdio:["ignore",log,log],env:{...process.env,OSA_E2E_API_PORT:"3199",OSA_EXECUTION_MODE:"fixture",NVIDIA_API_KEY:"",OPENROUTER_API_KEY:""}}));
  await ready(base+"/api/build/status");
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  const report=[];
  try {
    for(const [name,width,height] of [["android-390",390,844],["desktop",1440,900]]){
      const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
      const failures=[],requests=[];page.on("pageerror",e=>failures.push(e.message));
      page.on("request",r=>{if(r.url().includes("/api/unified/"))requests.push({method:r.method(),url:r.url()});});
      const loaded=await page.goto(base,{waitUntil:"domcontentloaded"});
      assert.equal(loaded?.status(),200);
      await page.getByTestId("osa-native-chat").waitFor({state:"visible"});
      assert.equal(await page.locator('iframe[title="Jeverson Chat"]').count(),0);
      const input="OSA Unified Runtime V1";
      const expectedHash=crypto.createHash("sha256").update(input).digest("hex");
      await page.getByTestId("osa-composer").fill("Oblicz SHA-256 tekstu: "+input);
      await page.getByTestId("osa-send").click();
      const answer=page.getByTestId("osa-message").filter({hasText:expectedHash});
      await answer.waitFor({state:"visible",timeout:25000});
      assert.match(await answer.innerText(),/VERIFIED/);
      const execution=await answer.innerText();
      assert.match(execution,/exec_[a-f0-9-]{36}/);
      assert.equal(requests.filter(r=>r.url.endsWith("/api/unified/execute")).length,1);
      assert.equal(requests.filter(r=>r.url.endsWith("/api/unified/verify")).length,1);
      await page.screenshot({path:path.join(out,name+"-chat.png"),fullPage:true});
      await page.getByRole("button",{name:"Inspektor"}).click();
      const inspect=page.getByTestId("osa-inspector");
      await inspect.waitFor({state:"visible"});
      assert.match(await inspect.innerText(),/VERIFIED/);
      assert.match(await inspect.innerText(),/Evidence: [1-9]/);
      await inspect.getByRole("button",{name:/Replay/}).click();
      await page.getByRole("slider",{name:"Replay position"}).waitFor({state:"visible"});
      await page.screenshot({path:path.join(out,name+"-replay.png"),fullPage:true});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      assert.ok(overflow<=1,"Native Runtime chat overflow: "+overflow);
      assert.deepEqual(failures,[]);
      const row={name,result:"PASS",execution_id:execution.match(/exec_[a-f0-9-]{36}/)[0],crypto_sha256:expectedHash,real_runtime:true,verified_receipt:true,replay_ui:true,provider_model_tool_call:"NOT_TESTED",paid_calls:0};
      console.log(JSON.stringify(row));report.push(row);await page.close();
    }
  }finally{await browser.close();}
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const child of children)child.kill("SIGTERM");});
