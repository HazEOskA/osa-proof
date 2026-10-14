import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const proof = process.env.OSA_REMOTE_PROOF_URL;
if (!proof || !proof.startsWith("https://")) throw new Error("OSA_REMOTE_PROOF_URL HTTPS required");
mkdirSync("artifacts/jeverson-remote-embed", { recursive: true });
const browser = await chromium.launch({
  headless: true, args: ["--no-sandbox","--use-gl=swiftshader","--disable-dev-shm-usage"]
});
try {
  for (const [id, w, h] of [["mobile-390x844",390,844],["mobile-320x640",320,640],["desktop-1440x900",1440,900]]) {
    const page = await browser.newPage({viewport:{width:w,height:h},reducedMotion:"reduce"});
    const response = await page.goto(proof, {waitUntil:"domcontentloaded",timeout:45000});
    assert.equal(response?.status(),200,`${id}: OSA Proof returned HTTP 200`);
    if(w<768) await page.getByRole("button",{name:"Open navigation"}).click();
    await page.getByRole("button",{name:"Jeverson Chat"}).click();
    const frame = page.frameLocator('iframe[title="Jeverson Chat"]');
    const live = page.getByRole("button",{name:"LIVE",exact:true});
    const black = page.getByRole("button",{name:"BLACK",exact:true});
    await frame.locator(".osa-app .composer").waitFor({state:"visible",timeout:45000});
    assert.equal(await live.getAttribute("aria-pressed"),"true");
    const liveUrl=await page.getByTestId("jeverson-iframe").getAttribute("src");
    assert.match(liveUrl||"",/aether-eight-theta-52\.vercel\.app/);
    await page.screenshot({path:`artifacts/jeverson-remote-embed/${id}-live.png`,fullPage:true});

    await black.click();
    await frame.locator(".osa-app .composer").waitFor({state:"visible",timeout:45000});
    const blackUrl=await page.getByTestId("jeverson-iframe").getAttribute("src");
    assert.match(blackUrl||"",/aether-git-feature-jeverson-verc/);
    assert.equal(await black.getAttribute("aria-pressed"),"true");
    const computed=await frame.locator(".osa-app").evaluate(el=>({
      bg:getComputedStyle(el).backgroundColor,
      composer:getComputedStyle(el.querySelector(".composer")).backgroundColor,
    }));
    assert.equal(computed.bg,"rgb(0, 0, 0)");
    assert.equal(computed.composer,"rgb(17, 17, 17)");
    const boxes=await page.evaluate(()=>{
      const coords=(selector)=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
      return {toolbar:coords('[data-testid="jeverson-toolbar"]'),iframe:coords('[data-testid="jeverson-iframe"]'),scrollWidth:document.documentElement.scrollWidth};
    });
    assert.ok(boxes.scrollWidth<=w+1,`${id} horizontal overflow`);
    assert.ok(boxes.toolbar.height<=76,`${id} header enlarged`);
    assert.ok(boxes.iframe.height>=h*.6,`${id} iframe too short`);
    assert.ok(boxes.iframe.bottom<=h+1,`${id} iframe clipped`);
    await page.screenshot({path:`artifacts/jeverson-remote-embed/${id}-black.png`,fullPage:true});

    await live.click();
    await frame.locator(".osa-app .composer").waitFor({state:"visible",timeout:45000});
    assert.equal(await live.getAttribute("aria-pressed"),"true");
    console.log(JSON.stringify({viewport:id,status:"PASS",liveOrigin:new URL(liveUrl).origin,blackOrigin:new URL(blackUrl).origin,computed,boxes}));
    await page.close();
  }
} finally {
  await browser.close();
}
