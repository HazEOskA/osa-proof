import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base=process.env.OSA_UI_TEST_BASE||"http://127.0.0.1:3100";
const out="artifacts/chat-history";fs.mkdirSync(out,{recursive:true});
const KEY="osa.native-chat.v1",ACTIVE="osa.native-chat.active.v1",DB="osa.native-chat.history.v2";
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const status=async page=>{
  await page.waitForFunction(()=>document.querySelector('[data-testid="osa-history-status"]')?.textContent?.includes("ZAPISANO W INDEXEDDB"),{timeout:20000});
};
const openChat=async page=>{
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
  await page.getByTestId("osa-native-chat").waitFor();
};
const fixedMessage=(text,role)=>({id:randomUUID(),role,text,at:new Date().toISOString(),status:role==="user"?"USER":"MODEL"});
const fetchRow=async page,id=>page.evaluate(async({dbName,sessionId})=>{
  return await new Promise((resolve,reject)=>{
    const request=indexedDB.open(dbName,1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction("sessions","readonly");
      const req=tx.objectStore("sessions").get(sessionId);
      req.onsuccess=()=>resolve(req.result??null);
      req.onerror=()=>reject(req.error);
      tx.oncomplete=()=>db.close();
    };
  });
},{dbName:DB,sessionId:id});
try{
  for(const [view,width,height] of [["android-390",390,844],["desktop",1440,900]]){
    const context=await browser.newContext({viewport:{width,height}});
    const page=await context.newPage(),pageErrors=[];
    page.on("pageerror",e=>pageErrors.push(e.message));
    const legacyId=randomUUID(),legacy="Zachowana starsza rozmowa OSA";
    const fixture={
      id:legacyId,title:"Migracja starej historii",agent:"jeverson",model:"auto",
      updated:new Date().toISOString(),
      messages:[fixedMessage("Zapisane pytanie: migracja", "user"),fixedMessage(legacy,"assistant")]
    };
    // Seed old data BEFORE the React app boots; the bootstrap path must not load any app JS.
    await page.goto(base+"/__history_bootstrap__",{waitUntil:"domcontentloaded"});
    await page.evaluate(({key,active,item})=>{
      localStorage.setItem(key,JSON.stringify([item]));
      localStorage.setItem("osa.native-chat.active.v1",active);
    },{key:KEY,active:legacyId,item:fixture});
    await openChat(page);
    await status(page);
    assert.equal(await page.getByTestId("osa-session").count(),1);
    await page.getByText(legacy,{exact:true}).waitFor();
    assert.equal((await fetchRow(page,legacyId)).messages.length,2,"Migrated legacy messages committed");
    // On a real device, a failed legacy localStorage quota must not erase the new IDB history.
    await page.evaluate(({key})=>{
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){
        if(k===key||k==="osa.native-chat.active.v1")throw new DOMException("No free localStorage quota","QuotaExceededError");
        return original.call(this,k,v);
      };
    },{key:KEY});
    await page.route("**/api/nvidia/status",route=>route.fulfill({json:{provider:"NVIDIA",configured:true,model:"controlled-test"}}));
    await page.route("**/api/nvidia/fleet-chat",route=>{
      const payload=route.request().postDataJSON();
      assert.match(payload.prompt,/Historia zostaje/);
      return route.fulfill({json:{text:"ODPOWIEDŹ TRWALE ZAPISANA",status:"PROVIDER_RESPONSE",
        model:"controlled-test",provider_model:"controlled-test",request_id:"fixture",
        provider_response_id:"fixture-response",latency_ms:1}});
    });
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    await status(page);
    await page.getByText(legacy,{exact:true}).waitFor();
    await page.getByText("NVIDIA · KLUCZ GOTOWY").waitFor();
    await page.getByTestId("osa-composer").fill("Historia zostaje po wyjściu z aplikacji");
    await page.getByTestId("osa-send").click();
    await page.getByText("ODPOWIEDŹ TRWALE ZAPISANA",{exact:true}).waitFor();
    await status(page);
    const before=await fetchRow(page,legacyId);
    assert.equal(before.messages.length,4,"User and provider answer persisted in IDB");
    // Simulate Android background/browser closure; only the browser context/storage survives.
    await page.close();
    const resumed=await context.newPage();resumed.on("pageerror",e=>pageErrors.push(e.message));
    await resumed.route("**/api/nvidia/status",route=>route.fulfill({json:{provider:"NVIDIA",configured:true,model:"controlled-test"}}));
    await openChat(resumed);
    await status(resumed);
    await resumed.getByText("ODPOWIEDŹ TRWALE ZAPISANA",{exact:true}).waitFor();
    assert.equal(await resumed.getByTestId("osa-message").count(),4);
    assert.equal((await fetchRow(resumed,legacyId)).messages.length,4);
    await resumed.close();

    // Inject a large synthetic 7 MiB bundle in a second conversation while the UI is closed.
    // The pre-fix 5 MiB localStorage path cannot represent this payload.
    const seed=await context.newPage();
    await seed.goto(base+"/__history_bootstrap__",{waitUntil:"domcontentloaded"});
    const largeId=randomUUID(),bytes=7*1024*1024;
    await seed.evaluate(async({dbName,sessionId,bytes})=>{
      const req=indexedDB.open(dbName,1);
      const db=await new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      const session={
        id:sessionId,title:"Duży bundle historii",agent:"jeverson",model:"auto",updated:new Date().toISOString(),
        messages:[{id:crypto.randomUUID(),role:"user",text:"Test dużego bundla",status:"USER",at:new Date().toISOString()},
          {id:crypto.randomUUID(),role:"assistant",text:"Zachowany wynik",status:"VERIFIED",at:new Date().toISOString(),
           executionId:"exec_"+crypto.randomUUID(),delivery:{schema:"synthetic-test-only",artifact:{content:"X".repeat(bytes)}}}]
      };
      await new Promise((resolve,reject)=>{
        const tx=db.transaction("sessions","readwrite");
        tx.objectStore("sessions").put(session);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });db.close();
    },{dbName:DB,sessionId:largeId,bytes});
    await seed.close();
    const restored=await context.newPage();
    restored.on("pageerror",e=>pageErrors.push(e.message));
    await openChat(restored);
    await status(restored);
    assert.equal(await restored.getByTestId("osa-session").count(),2,"Both conversations remain");
    assert.equal((await fetchRow(restored,largeId)).messages[1].delivery.artifact.content.length,bytes);
    // Refresh must not truncate the large proof object or revert to stale localStorage.
    await restored.reload({waitUntil:"domcontentloaded"});
    await restored.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    await status(restored);
    assert.equal((await fetchRow(restored,largeId)).messages[1].delivery.artifact.content.length,bytes);
    assert.equal(await restored.getByTestId("osa-session").count(),2);
    assert.deepEqual(pageErrors,[],"No uncaught client errors");
    await restored.screenshot({path:out+"/"+view+"-history.png",fullPage:true});
    console.log(JSON.stringify({view,result:"PASS",legacy_migrated:true,
      real_chat_response_saved:true,closed_browser_reopened:true,
      large_bundle_bytes:bytes,history_store:"IndexedDB",provider:"CONTROLLED_TEST_ONLY"}));
    await context.close();
  }
}finally{await browser.close();}
