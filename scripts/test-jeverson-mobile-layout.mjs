import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.env.OSA_UI_TEST_BASE || "http://127.0.0.1:3100";
const out = "artifacts/osa-native-chat";
fs.mkdirSync(out,{recursive:true});
const browser = await chromium.launch({headless:true,...(process.env.OSA_CHROMIUM_EXECUTABLE?{executablePath:process.env.OSA_CHROMIUM_EXECUTABLE}:{}),args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
  for (const [name,width,height] of [["android-320",320,640],["android-390",390,844],["desktop",1440,900]]) {
    const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
    const pageErrors=[],network=[];
    page.on("pageerror",error=>pageErrors.push(error.message));
    page.on("request",request=>{if(/\/api\/(nvidia\/chat|unified\/execute|chat\/complete)/.test(request.url()))network.push(request.url());});
    await page.route("**/api/build/status",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({mode:"fixture",auth_mode:"open",persistence:"PROCESS_MEMORY"})}));
    // Explicit public/development state; a failed auth check must never restore a private cache.
    await page.route("**/api/memory/status",route=>route.fulfill({json:{state:"UNCONFIGURED",persistence_verified:false}}));
    await page.route("**/api/nvidia/status",route=>route.fulfill({json:{provider:"NVIDIA",configured:false,model:"test-model"}}));
    const opened=await page.goto(base,{waitUntil:"domcontentloaded",timeout:30000});
    assert.equal(opened?.status(),200,"Dashboard HTTP 200");
    const home=page.locator('section[aria-label="Uruchamianie"]');
    await home.waitFor({state:"visible",timeout:15000});
    assert.equal(await page.getByTestId("osa-native-chat").count(),0,"Framework Home, not chat, is default");
    assert.equal(await home.getByRole("button",{name:"Czat floty agentów",exact:true}).count(),1,"Chat Fleet is an optional Home module");
    await home.getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    const shell=page.getByTestId("osa-native-chat");await shell.waitFor({state:"visible",timeout:15000});
    await page.screenshot({path:out+"/"+name+"-pusty-czat.png",fullPage:true});
    assert.equal(await page.getByText("Logowanie GitHub nie jest skonfigurowane.",{exact:true}).count(),0);
    if(width<768) {
      const options=page.getByRole("button",{name:"Opcje czatu"});
      assert.equal(await options.getAttribute("aria-expanded"),"false");
      await options.click();
      assert.equal(await options.getAttribute("aria-expanded"),"true");
    }
    await page.getByText("TRYB TESTOWY · MODEL NIEDOSTĘPNY",{exact:true}).waitFor();
    assert.equal(await page.locator('iframe[title="Jeverson Chat"]').count(),0,"No cross-origin iframe");
    assert.equal(await page.locator(".osa-sidebar").count(),0,"No nested OSA dashboard navigation");
    assert.equal(await page.getByRole("heading",{name:width<768?"OSA Proof":"Jeverson · flota OSA"}).count(),1,"One chat-module header");
    assert.equal(await page.getByTestId("osa-hermes-switch").count(),1,"Persistent Hermes switch is present");
    assert.equal(await page.getByTestId("osa-jeverson-switch").count(),1,"Persistent Jeverson switch is present");
    await page.getByTestId("osa-jeverson-switch").click();
    assert.equal(await page.getByTestId("osa-jeverson-switch").getAttribute("aria-pressed"),"true");
    if(width>=768) assert.equal(await page.getByRole("button",{name:"Powrót do frameworka OSA Proof"}).count(),1,"Framework return on desktop");
    assert.equal(await page.getByTestId("osa-session").count(),1,"Exactly one initial session");
    await page.getByRole("button",{name:"Wybierz agenta"}).click();
    await page.getByTestId("osa-agent-picker").getByRole("button",{name:/Agent programistyczny/}).click();
    assert.match(await page.getByRole("button",{name:"Wybierz agenta"}).innerText(),/Agent programistyczny/);
    await page.getByRole("combobox",{name:"Wybierz model"}).selectOption("nvidia");
    assert.equal(await page.getByRole("combobox",{name:"Wybierz model"}).inputValue(),"nvidia");
    await page.getByTestId("osa-composer").fill("P0: kontrola izolacji sesji A");
    await page.getByTestId("osa-send").click();
    await page.getByTestId("osa-chat-notice").waitFor();
    assert.match(await page.getByTestId("osa-chat-notice").innerText(),/MODEL NIEDOSTĘPNY/);
    assert.equal(await page.getByTestId("osa-message").count(),1,"Blocked request must not forge assistant answer");
    assert.equal(network.length,0,"Blocked LLM must never reach provider API");
    if(width<768)await page.getByRole("button",{name:"Otwórz historię"}).click();
    await page.getByTestId("osa-new-chat").click();
    assert.equal(await page.getByTestId("osa-session").count(),2,"New chat creates exactly one session");
    assert.equal(await page.getByTestId("osa-message").count(),0,"New chat must not reuse previous messages");
    assert.equal(await page.getByTestId("osa-composer").inputValue(),"");
    await page.getByTestId("osa-composer").fill("P0: kontrola izolacji sesji B");
    await page.getByTestId("osa-send").click();
    assert.equal(await page.getByTestId("osa-message").count(),1);
    if(width<768)await page.getByRole("button",{name:"Otwórz historię"}).click();
    await page.getByTestId("osa-session").filter({hasText:"kontrola izolacji sesji A"}).click();
    assert.match(await page.getByTestId("osa-message").innerText(),/sesji A/);
    assert.doesNotMatch(await page.getByTestId("osa-message").innerText(),/sesji B/);
    await page.getByRole("button",{name:"Inspektor"}).click();
    await page.getByTestId("osa-inspector").waitFor({state:"visible"});
    assert.match(await page.getByTestId("osa-inspector").innerText(),/BRAK ZWERYFIKOWANEGO WYKONANIA/);
    await page.getByRole("button",{name:"Zamknij",exact:true}).first().click();
    if(width<768) {
      await page.getByRole("button",{name:"Otwórz historię"}).click();
      await page.getByRole("button",{name:"Powrót do OSA Proof"}).click();
    } else await page.getByRole("button",{name:"Powrót do frameworka OSA Proof"}).click();
    await home.waitFor({state:"visible"});
    assert.equal(await shell.count(),0,"Chat must not replace the framework after return");
    assert.equal(await home.getByRole("button",{name:"Świat",exact:true}).count(),1,"Original World module preserved");
    assert.equal(await home.getByRole("button",{name:"Misje",exact:true}).count(),1,"Original Missions module preserved");
    await page.reload({waitUntil:"domcontentloaded"});
    await home.waitFor({state:"visible"});
    await home.getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    await shell.waitFor({state:"visible"});
    assert.equal(await page.getByText("Logowanie GitHub nie jest skonfigurowane.",{exact:true}).count(),0);
    assert.match(await page.getByTestId("osa-message").innerText(),/sesji A/);
    assert.equal(await page.getByTestId("osa-session").count(),2,"Session persists after refresh");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,name+" horizontal overflow "+overflow);
    assert.deepEqual(pageErrors,[],"No browser uncaught exceptions");
    await page.screenshot({path:out+"/"+name+".png",fullPage:true});
    // Contract simulation only; the real NVIDIA provider is never mocked in application code.
    let providerRequests=0;
    await page.route("**/api/nvidia/status",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({provider:"NVIDIA",configured:true,model:"nvidia/test-model"})}));
    await page.route("**/api/nvidia/fleet-live",route=>{
      const body=route.request().postDataJSON();
      assert.equal(body.agent,"coding","Chosen AI persona travels to backend");
      assert.equal(body.prompt,"Cześć OSA","User text travels to provider route");
      assert.ok(Array.isArray(body.history),"History is sent as structured messages");
      providerRequests++;
      assert.match(body.execution_id,/^exec_/);
      const events=[
        ["accepted",{execution_id:body.execution_id,conversation_id:body.conversation_id,mode:"conversation"}],
        ["trace",{schema:"osa.live_execution.v1",execution_id:body.execution_id,phase:"accepted",state:"RUNNING",at:new Date().toISOString(),source:"API",detail:"Przyjęto"}],
        ["trace",{schema:"osa.live_execution.v1",execution_id:body.execution_id,phase:"model_started",state:"RUNNING",at:new Date().toISOString(),source:"NVIDIA",detail:"Model uruchomiony"}],
        ["trace",{schema:"osa.live_execution.v1",execution_id:body.execution_id,phase:"model_completed",state:"RUNNING",at:new Date().toISOString(),source:"NVIDIA",detail:"Odpowiedź"}],
        ["trace",{schema:"osa.live_execution.v1",execution_id:body.execution_id,phase:"completed",state:"COMPLETED",at:new Date().toISOString(),source:"API",detail:"Zakończono"}],
        ["complete",{execution_id:body.execution_id,conversation_id:body.conversation_id,text:"Witaj, jestem asystentem OSA.",model:"nvidia/test-model",provider_response_id:"synthetic-contract-id",request_id:"synthetic-contract-request",latency_ms:1,status:"PROVIDER_RESPONSE"}]
      ];
      return route.fulfill({status:200,contentType:"text/event-stream; charset=utf-8",body:events.map(([type,data])=>"event: "+type+"\ndata: "+JSON.stringify(data)+"\n\n").join("")});
    });
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    if(width<768) await page.getByRole("button",{name:"Opcje czatu"}).click();
    await page.getByText("NVIDIA · KLUCZ GOTOWY").waitFor({state:"visible",timeout:15000});
    await page.getByTestId("osa-composer").fill("Cześć OSA");
    await page.getByTestId("osa-send").click();
    await page.getByText("Witaj, jestem asystentem OSA.").waitFor({state:"visible"});
    assert.equal(providerRequests,1,"AI transport contract called exactly once");
    const trace=page.getByTestId("osa-unified-live-trace").last();
    await trace.waitFor();await trace.getByText(/ZAKOŃCZONO/).first().waitFor();
    assert.match(await trace.innerText(),/NVIDIA/);
    const traceFile=page.waitForEvent("download");
    await trace.getByRole("button",{name:"Pobierz trace"}).click();
    const dl=await traceFile;assert.match(dl.suggestedFilename(),/trace.jsonl$/);
    assert.match(await page.getByTestId("osa-message").last().innerText(),/ODPOWIEDŹ MODELU AI/);
    assert.match(await page.getByTestId("osa-message").last().innerText(),/NVIDIA · NVIDIA\/TEST-MODEL/i);
    // UI cancellation regression: abort a pending live-model request, request server cancellation,
    // preserve a truthful CANCEL_REQUESTED trace instead of a pretend provider acknowledgement.
    await page.route("**/api/chat/live-cancel",async route=>{
      const body=route.request().postDataJSON();
      assert.match(body.execution_id,/^exec_/);
      await route.fulfill({status:202,json:{execution_id:body.execution_id,status:"CANCEL_REQUESTED",
        detail:"Żądanie anulowania przyjęto do obsługi; provider nie potwierdził."}});
    });
    await page.route("**/api/nvidia/fleet-live",async route=>{
      const body=route.request().postDataJSON();
      if(body.prompt!=="Przerwij test OSA")return route.fallback();
      await new Promise(resolve=>setTimeout(resolve,2500));
      try{await route.abort("failed");}catch{}
    });
    await page.getByTestId("osa-composer").fill("Przerwij test OSA");
    await page.getByTestId("osa-send").click();
    const cancelButton=page.getByTestId("osa-live-cancel").last();
    await cancelButton.waitFor();
    await cancelButton.click();
    await page.getByText(/Przerwanie zgłoszone serwerowi/).waitFor({timeout:15000});
    const persistedCancel=page.getByTestId("osa-unified-live-trace").last();
    assert.match(await persistedCancel.innerText(),/PRZERWANIE ZGŁOSZONE/);
    assert.equal(await persistedCancel.getByRole("button",{name:/ProofReceipt/}).count(),0);
    // Hermes must not disappear when a conversation has messages or when starting
    // a fresh chat; its agent selection must survive browser refresh.
    await page.getByTestId("osa-hermes-switch").click();
    assert.equal(await page.getByTestId("osa-hermes-switch").getAttribute("aria-pressed"),"true");
    assert.match(await page.getByRole("button",{name:"Wybierz agenta"}).innerText(),/Hermes/);
    if(width<768)await page.getByRole("button",{name:"Otwórz historię"}).click();
    await page.getByTestId("osa-new-chat").click();
    assert.match(await page.getByRole("button",{name:"Wybierz agenta"}).innerText(),/Hermes/);
    assert.equal(await page.getByTestId("osa-hermes-switch").count(),1);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
    await page.getByTestId("osa-native-chat").waitFor({state:"visible"});
    await page.getByRole("button",{name:"Wybierz agenta"}).filter({hasText:"Hermes"}).waitFor();
    assert.equal(await page.getByTestId("osa-hermes-switch").getAttribute("aria-pressed"),"true");
    console.log(JSON.stringify({name,ai_transport_contract:"PASS",real_provider:"NOT_TESTED",intercepted_responses:providerRequests}));

    console.log(JSON.stringify({name,result:"PASS",sessions:2,agent_selector:true,model_selector:true,blocked_model_requests:network.length,verified_proof:"NOT_TESTED",overflow,page_errors:pageErrors.length}));
    await page.close();
  }
}finally{await browser.close();}
