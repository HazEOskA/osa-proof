import assert from "node:assert/strict";
import {chromium} from "playwright";
const base=process.env.OSA_UI_TEST_BASE||"http://127.0.0.1:3100";
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
try {
  for(const width of [320,390,1440]) {
    const page=await browser.newPage({viewport:{width,height:width===1440?900:760},reducedMotion:"reduce"});
    const errors=[];page.on("pageerror",err=>errors.push(err.message));
    await page.route("**/api/build/status",route=>route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({auth_mode:"session",brain:{memory:"NONE"},mode:"fixture"})}));
    await page.route("**/api/session",route=>route.fulfill({status:401,contentType:"application/json",body:"{}"}));
    await page.route("**/api/auth/social/status",route=>route.fulfill({status:200,contentType:"application/json",
      body:JSON.stringify({providers:{google:true,github:true},authenticated:false,identity:null})}));
    const requests=[];
    await page.route("**/api/auth/social/*/start?*",async route=>{
      requests.push(new URL(route.request().url()).pathname);
      await route.fulfill({status:302,headers:{location:base+"/oauth-provider-redirect"},body:""});
    });
    await page.goto(base,{waitUntil:"domcontentloaded"});
    const dialog=page.getByRole("dialog",{name:"Zaloguj do OSA Proof"});
    await dialog.waitFor({state:"visible",timeout:15000});
    assert.equal(await dialog.getByRole("button",{name:"Kontynuuj z Google"}).isEnabled(),true);
    assert.equal(await dialog.getByRole("button",{name:"Kontynuuj z GitHub"}).isEnabled(),true);
    await dialog.getByRole("button",{name:"Kontynuuj z Google"}).click();
    await page.waitForURL(/oauth-provider-redirect/);
    assert.deepEqual(requests,["/api/auth/social/google/start"]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({viewport:width,socialLogin:"PASS",providerRedirect:"google",realProvider:"NOT_TESTED"}));
    await page.close();
  }
}finally{await browser.close();}
