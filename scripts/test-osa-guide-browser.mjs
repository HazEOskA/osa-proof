import assert from "node:assert/strict";
import {chromium} from "playwright";
const base=process.env.OSA_UI_TEST_BASE||"http://127.0.0.1:3100";
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
  for(const [name,width,height] of [["telefon-320",320,640],["telefon-390",390,844],["desktop",1440,900]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    let providerCalls=0;
    await page.route("**/api/nvidia/status",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({configured:true,provider:"NVIDIA",model:"nvidia/test"})}));
    await page.route("**/api/nvidia/fleet-chat",route=>{
      const q=route.request().postDataJSON();
      assert.equal(q.agent,"guide");
      assert.equal(q.view,"home");
      assert.match(q.prompt,/Jak zacząć pracę/);
      assert.ok(Array.isArray(q.history));
      providerCalls++;
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({status:"PROVIDER_RESPONSE",text:"Otwórz BUDOWANIE → Agenci."})});
    });
    await page.goto(base,{waitUntil:"domcontentloaded"});
    const home=page.locator('section[aria-label="Uruchamianie"]');
    await home.waitFor({state:"visible",timeout:15000});
    const trigger=page.getByTestId("osa-help-trigger");
    await trigger.waitFor({state:"visible"});
    await trigger.click();
    const panel=page.getByTestId("osa-help-panel");
    await panel.waitFor({state:"visible"});
    assert.match(await panel.innerText(),/Na tym ekranie · Strona główna/i);
    await panel.getByRole("button",{name:/Jak zacząć pracę z OSA Proof/}).click();
    await panel.getByText("Otwórz BUDOWANIE → Agenci.").waitFor({state:"visible"});
    assert.equal(providerCalls,1);
    await panel.getByRole("button",{name:/Przejdź dalej: Agenci/}).click();
    await panel.getByText("Na tym ekranie · Agenci").waitFor({state:"visible"});
    assert.match(await panel.innerText(),/Twórz role w grafie zespołu/);
    await panel.getByRole("button",{name:"Zamknij pomoc OSA"}).click();
    assert.equal(await panel.count(),0);
    assert.equal(await trigger.count(),1,"Help tab persists on every framework screen");
    if(width<768){await page.getByRole("button",{name:"Otwórz nawigację"}).click();await page.getByRole("button",{name:"Strona główna",exact:true}).click();}
    else await page.getByRole("button",{name:"Strona główna",exact:true}).first().click();
    await home.waitFor({state:"visible"});
    await home.getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    await page.getByTestId("osa-native-chat").waitFor({state:"visible"});
    await trigger.waitFor({state:"visible"});
    await trigger.click();
    await page.getByTestId("osa-help-panel").getByText("Na tym ekranie · Czat floty agentów").waitFor({state:"visible"});
    assert.equal(await page.locator("iframe").count(),0,"Guide is native, not iframe");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,"No horizontal overflow: "+overflow);
    assert.deepEqual(errors,[],"No page errors");
    console.log(JSON.stringify({name,globalGuide:"PASS",homeHelp:true,moduleContext:true,fleetChatContext:true,simulatedProvider:true,realProvider:"NOT_TESTED",providerCalls,overflow}));
    await page.close();
  }
}finally{await browser.close();}
