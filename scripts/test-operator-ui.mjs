import assert from "node:assert/strict";
import fs from "node:fs";
import {chromium,devices} from "playwright";
const browser=await chromium.launch({executablePath:process.env.OSA_CHROMIUM_EXECUTABLE||undefined,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const base=process.env.OSA_UI_TEST_BASE||"http://127.0.0.1:3100";
fs.mkdirSync("artifacts/osa-operator",{recursive:true});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:844},...(width<768?{isMobile:true,hasTouch:true,userAgent:devices["Pixel 7"].userAgent}:{})});let requests=0;
  await page.route("**/api/auth/access",r=>r.fulfill({json:{required:true,configured:false,authenticated:false,scope:null}}));
  page.on("request",r=>{if(r.url().includes("/api/nvidia/"))requests++;});
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"Dostęp operatora"}).waitFor({state:"visible"});
  await page.getByText("Dostęp jest zablokowany.",{exact:false}).waitFor({state:"visible"});
  assert.equal(await page.getByTestId("osa-help-trigger").count(),0);assert.equal(await page.getByTestId("osa-native-chat").count(),0);assert.equal(requests,0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
  await page.screenshot({path:`artifacts/osa-operator/blocked-${width}.png`});await page.close();
 }
 const page=await browser.newPage();let project="a";
 await page.route("**/api/auth/access",r=>r.fulfill({json:{required:true,configured:true,authenticated:true,scope:{organization_id:"org_test",project_id:project}}}));
 await page.goto(base,{waitUntil:"domcontentloaded"});
 await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
 await page.getByTestId("osa-composer").fill("WIADOMOŚĆ WYŁĄCZNIE PROJEKTU A");await page.getByTestId("osa-send").click();
 await page.getByTestId("osa-message").filter({hasText:"WIADOMOŚĆ WYŁĄCZNIE PROJEKTU A"}).waitFor();
 project="b";await page.reload({waitUntil:"domcontentloaded"});
 await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
 assert.equal(await page.getByTestId("osa-message").count(),0,"Historia projektu A nie może przejść do projektu B");
 project="a";await page.reload({waitUntil:"domcontentloaded"});
 await page.locator('section[aria-label="Uruchamianie"]').getByRole("button",{name:"Czat floty agentów",exact:true}).click();
 await page.getByTestId("osa-message").filter({hasText:"WIADOMOŚĆ WYŁĄCZNIE PROJEKTU A"}).waitFor();
 console.log(JSON.stringify({operator_ui_contract:"PASS",widths:[320,390,1440],project_history_isolation:true,api_auth:"TESTED_SEPARATELY",real_provider:"NOT_TESTED",auth_response:"SIMULATED"}));
 await page.close();
}finally{await browser.close();}
