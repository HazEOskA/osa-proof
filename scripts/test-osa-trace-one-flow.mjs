import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const screenshots="artifacts/osa-trace-one-flow";
fs.mkdirSync(screenshots,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try{
for(const [name,width,height] of [["android-390x844",390,844],["desktop-1440x900",1440,900]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
 page.setDefaultTimeout(20000);
 page.on("pageerror",e=>console.error("PAGE_ERROR",String(e.message).slice(0,250)));
 await page.route("https://jeverson.ui.test/**",route=>route.fulfill({
    status:200,contentType:"text/html",
    body:"<html><body><main>Jeverson iframe CI; no model generation</main></body></html>"}));
 await page.route("https://black.ui.test/**",route=>route.fulfill({
    status:200,contentType:"text/html",body:"<html><body>Black UI CI</body></html>"}));
 const first=await page.goto("http://127.0.0.1:3100",{waitUntil:"domcontentloaded"});
 assert.equal(first.status(),200);
 if(width<768) await page.getByRole("button",{name:"Open navigation"}).click();
 await page.getByRole("button",{name:"Jeverson Chat"}).click();
 await page.getByRole("button",{name:"OSA-TRACE-001 — monitorowane zadanie"}).click();
 await page.getByRole("dialog",{name:"Monitorowane zadanie OSA Proof"}).waitFor();
 const task=page.getByRole("textbox",{name:"Monitorowane zadanie OSA-TRACE-001"});
 assert.match(await task.inputValue(),/\/api\/layers/);
 assert.match(await task.inputValue(),/\/api\/build\/status/);
 const http=page.waitForResponse(r=>r.url().endsWith("/api/trace-probe")&&r.request().method()==="POST");
 await page.getByRole("button",{name:"Wykonaj monitorowane zadanie"}).click();
 const response=await http;assert.equal(response.status(),200);
 const result=page.getByLabel("OSA Proof Trace Result");
 await result.getByText(/EXECUTED · OSA Proof VERIFIED/).waitFor({timeout:30000});
 const proofText=await result.innerText();
 assert.match(proofText,/execution_id: exec_/);
 assert.match(proofText,/1\. GET .+\/api\/layers · HTTP 200 · OK/);
 assert.match(proofText,/2\. GET .+\/api\/build\/status · HTTP 200 · OK/);
 await page.screenshot({path:screenshots+"/"+name+"-task.png",fullPage:false});
 await result.getByRole("button",{name:"Tracing →"}).click();
 await page.getByRole("tab",{name:"TIMELINE"}).waitFor();
 await page.getByText("EVIDENCE_RECORDED").first().waitFor();
 await page.screenshot({path:screenshots+"/"+name+"-trace.png",fullPage:false});
 await page.getByRole("button",{name:"Proofs"}).click();
 await page.getByText("RUN VERIFIED").waitFor();
 await page.getByText(/receipt_sha256/).waitFor();
 await page.screenshot({path:screenshots+"/"+name+"-proof.png",fullPage:false});
 const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,
   viewport:document.documentElement.clientWidth}));
 assert.ok(metrics.width<=width+1,"HORIZONTAL_OVERFLOW");
 console.log(JSON.stringify({view:name,verdict:"PASS",
   flow:["OSA_Proof_Jeverson_view","native_operator_prompt","two_bounded_http_gets",
     "real_osa_runtime","true_evidence","trace_view","proof_view"],
   provider:"STUB_NONE",endpoint_responses:"CONTROLLED_TEST_DOUBLES",
   model_requests:0,horizontal_overflow:false}));
 await page.close();
}
}finally{await browser.close();}
