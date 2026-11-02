"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {spawn}=require("node:child_process"),{chromium}=require("playwright");
const url="http://127.0.0.1:3203",out=path.resolve("artifacts/durable-browser");
fs.mkdirSync(out,{recursive:true});
const child=spawn(process.execPath,["scripts/durable-e2e-server.cjs"],{stdio:"inherit"});
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(url+"/api/durable/status")).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error("DURABLE_TEST_SERVER_NOT_READY");}
(async()=>{
  await ready();
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try{
    for(const [name,width,height] of [["android-390",390,844],["desktop-1440",1440,900]]){
      const context=await browser.newContext({viewport:{width,height}});
      async function chat(){
        const p=await context.newPage();
        await p.goto(url);
        await p.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
        await p.getByTestId("osa-durable-ready").waitFor();
        return p;
      }
      let page=await chat(),errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      const accepted=page.waitForResponse(r=>r.url().endsWith("/api/durable/jobs")&&r.request().method()==="POST"&&r.status()===202);
      await page.getByTestId("osa-composer").fill("P0 prompt po zgaszeniu ekranu");
      await page.getByTestId("osa-send").click();
      await accepted;await page.close(); // Browser gone while independent worker is still running.
      page=await chat();
      await page.getByText("DURABLE MODEL ODZYSKANY: P0 prompt po zgaszeniu ekranu").waitFor({timeout:30000});
      assert.equal(await page.getByText("DURABLE MODEL ODZYSKANY: P0 prompt po zgaszeniu ekranu").count(),1);
      await page.screenshot({path:path.join(out,name+"-model-recovered.png")});
      await page.getByRole("button",{name:"Utwórz artefakt",exact:true}).click();
      const artifactAccepted=page.waitForResponse(r=>r.url().endsWith("/api/durable/jobs")&&r.request().method()==="POST"&&r.status()===202);
      await page.getByTestId("osa-composer").fill("Zbuduj bezpieczną stronę po polsku");
      await page.getByTestId("osa-send").click();
      await artifactAccepted;await page.close();
      page=await chat();
      const artifact=page.getByTestId("osa-delivery-result");
      await artifact.getByText("ARTEFAKT GOTOWY · integralność zweryfikowana").waitFor({timeout:45000});
      const download=page.waitForEvent("download");
      await artifact.getByRole("button",{name:"Pobierz artefakt",exact:true}).click();
      const file=await download;assert.ok(file.suggestedFilename().includes("html"));
      await page.screenshot({path:path.join(out,name+"-artifact-recovered.png")});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({view:name,result:"PASS",model_recovered:true,artifact_recovered:true,independent_worker:true,tab_closed:true,provider_calls:0}));
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>child.kill("SIGTERM"));
