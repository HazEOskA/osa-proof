import assert from "node:assert/strict";
import {mkdirSync} from "node:fs";
import {chromium} from "playwright";

const target=process.env.OSA_REMOTE_PROOF_URL;
if (!target || !target.startsWith("https://")) throw Error("HTTPS target required for native chat QA");
const out="artifacts/osa-native-chat-remote";
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
  for(const [name,width,height] of [["mobile-320",320,640],["mobile-390",390,844],["desktop",1440,900]]) {
    const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const response=await page.goto(target,{waitUntil:"domcontentloaded",timeout:45000});
    assert.equal(response?.status(),200,"OSA native preview HTTP 200");
    const home=page.locator('section[aria-label="Uruchamianie"]');await home.waitFor({state:"visible",timeout:20000});
    await home.getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    await page.getByTestId("osa-native-chat").waitFor({state:"visible",timeout:20000});
    assert.equal(await page.locator('iframe[title="Jeverson Chat"]').count(),0,"No legacy iframe");
    if(width<768)await page.getByRole("button",{name:"Otwórz historię"}).click();
    await page.getByTestId("osa-new-chat").click();
    await page.getByTestId("osa-composer").fill("Kontrola bezpiecznej blokady modelu");
    await page.getByTestId("osa-send").click();
    assert.match(await page.getByTestId("osa-chat-notice").innerText(),/MODEL NIEDOSTĘPNY/);
    assert.equal(await page.getByTestId("osa-message").count(),1,"No forged assistant answer");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,"No horizontal overflow: "+name);
    assert.deepEqual(errors,[],"No browser exception");
    await page.screenshot({path:out+"/"+name+".png",fullPage:true});
    console.log(JSON.stringify({name,status:"PASS",no_iframe:true,model_gate:true,overflow,live_model_execution:"NOT_TESTED",proof:"NOT_TESTED"}));
    await page.close();
  }
} finally {await browser.close();}
