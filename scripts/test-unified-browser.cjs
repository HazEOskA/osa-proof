"use strict";
const path=require("node:path"),fs=require("node:fs"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const root=path.resolve(__dirname,".."),jev=process.env.JEV_ROOT||path.resolve(root,"../Jeverson");
const {chromium}=require(path.join(jev,"node_modules/playwright"));
const children=[];const out=path.join(root,"artifacts/unified-v1");fs.mkdirSync(out,{recursive:true});
const base=process.env.OSA_E2E_BASE||"http://127.0.0.1:3100";
async function ready(url){for(let i=0;i<100;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,300));}throw Error("SERVER_NOT_READY: "+url);}
function child(script,args,cwd,env,name){const fd=fs.openSync(path.join(out,name+".log"),"w");const c=spawn(script,args,{cwd,env,stdio:["ignore",fd,fd]});children.push(c);}
async function main(){
  if(!process.env.OSA_E2E_BASE){
    child(process.execPath,["scripts/unified-e2e-server.cjs"],root,process.env,"osa-server");
    child(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","3101"],jev,
      {...process.env,OSA_UNIFIED_RUNTIME_URL:base,NEXT_TELEMETRY_DISABLED:"1",NVIDIA_API_KEY:"",OPENROUTER_API_KEY:""},"jev-server");
  }
  await ready(base+"/api/build/status");
  if(!process.env.OSA_E2E_BASE)await ready("http://127.0.0.1:3101/api/cockpit");
  const browser=await chromium.launch({executablePath:process.env.OSA_CHROMIUM_PATH||path.resolve(root,"../browser-bin/chromium"),
    args:["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--disable-gpu-sandbox"]});
  const reports=[];
  try{
    for(const [name,width,height] of [["desktop",1440,900],["mobile",390,844]]){
      const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce",...(name==="mobile"?{isMobile:true,hasTouch:true,deviceScaleFactor:2,userAgent:"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"}:{})});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(base,{waitUntil:"domcontentloaded"});
      if(!await page.getByTestId("jeverson-iframe").isVisible()){
        if(width<768)await page.getByRole("button",{name:"Open navigation"}).click();
        await page.getByRole("button",{name:"Jeverson Chat",exact:true}).click();
      }
      const frame=page.frameLocator('iframe[title="Jeverson Chat"]');
      const input=frame.getByRole("textbox",{name:"Wiadomość do OSA"});await input.waitFor({timeout:45000});
      await input.fill("Oblicz SHA-256 tekstu: OSA Unified Runtime V1");
      await frame.getByRole("button",{name:"Wyślij",exact:true}).click();
      const summary=page.getByTestId("unified-result");await summary.waitFor({timeout:35000});
      await page.getByTestId("unified-result").filter({hasText:"EXECUTED"}).waitFor();
      const text=await summary.innerText();assert.match(text,/exec_[a-f0-9-]+/);
      const executionId=text.match(/exec_[a-f0-9-]+/)[0];
      await frame.locator(".message.assistant").filter({hasText:"osa.crypto.sha256.v1"}).waitFor();
      const output=await frame.locator(".message.assistant").last().innerText();
      assert.ok(output.includes(require("node:crypto").createHash("sha256").update("OSA Unified Runtime V1").digest("hex")));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(out,name+"-chat.png"),fullPage:true});
      // An unrelated window message must not be accepted as an execution.
      await page.evaluate(()=>window.postMessage({type:"osa.unified.result.v1",execution:{status:"EXECUTED"}},location.origin));
      assert.equal(await summary.innerText(),text);
      await page.getByRole("button",{name:"Tracing wykonania →"}).click();
      await page.getByText(executionId,{exact:true}).first().waitFor();
      await page.screenshot({path:path.join(out,name+"-trace.png"),fullPage:true});
      const proofButton=page.getByRole("button",{name:"Proofs →"});
      if(await proofButton.count())await proofButton.first().click();
      else {if(width<768)await page.getByRole("button",{name:"Open navigation"}).click();await page.getByRole("button",{name:"Proofs",exact:true}).click();}
      await page.getByText("receipt_sha256 = digest(receipt body)",{exact:true}).waitFor();
      await page.screenshot({path:path.join(out,name+"-proof.png"),fullPage:true});
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByTestId("unified-result").filter({hasText:executionId}).waitFor({timeout:35000});
      assert.match(await page.getByTestId("unified-result").innerText(),/Zapisany bundle/);
      reports.push({restored_bundle:true,emulated_android:name==="mobile",viewport:name,width,height,execution_id:executionId,status:"PASS",normal_chat:true,actual_crypto:true,trace:true,receipt:true,page_errors:errors});
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();}
  fs.writeFileSync(path.join(out,"browser-results.json"),JSON.stringify({network_replacements:0,paid_provider_calls:0,reports},null,2));
  console.log(JSON.stringify(reports));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const c of children)c.kill("SIGTERM");});
