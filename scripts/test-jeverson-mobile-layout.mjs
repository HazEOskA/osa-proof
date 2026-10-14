import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.OSA_UI_TEST_BASE || "http://127.0.0.1:3100";
const dir = "artifacts/jeverson-container";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  for (const [name, width, height] of [
    ["mobile-320x640", 320, 640],
    ["mobile-390x844", 390, 844],
    ["desktop-1440x900", 1440, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    // Visual-only test, no external Jeverson runtime or model requests.
    await page.route("https://jeverson.ui.test/**", async route => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head><body style='background:#080b10;color:#eee;font:16px sans-serif;margin:0;padding:24px'>JEVERSON AGENT WORLD / TEST FRAME</body></html>",
      });
    });
    const response = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.equal(response?.status(), 200, `${name}: dashboard HTTP 200`);
    if (width < 768) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("button", { name: "Jeverson Chat" }).click();
    const section = page.getByRole("region", { name: "Jeverson Chat" });
    const bar = page.getByTestId("jeverson-toolbar");
    const frame = page.frameLocator('iframe[title="Jeverson Chat"]');
    await bar.waitFor({ state: "visible" });
    await frame.getByText("JEVERSON AGENT WORLD / TEST FRAME").waitFor();
    const metrics = await page.evaluate(() => {
      const select = (sel) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error("Missing " + sel);
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      return {
        viewport: { w: innerWidth, h: innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        toolbar: select('[data-testid="jeverson-toolbar"]'),
        frame: select('iframe[title="Jeverson Chat"]'),
        footer: select('section[aria-label="Jeverson Chat"] footer'),
        section: select('section[aria-label="Jeverson Chat"]'),
      };
    });
    assert.ok(metrics.scrollWidth <= width + 1, `${name}: horizontal body scroll`);
    assert.ok(metrics.toolbar.height <= 76, `${name}: oversized toolbar ${metrics.toolbar.height}`);
    assert.ok(metrics.frame.height >= height * 0.60, `${name}: iframe too short ${metrics.frame.height}`);
    assert.ok(metrics.frame.y <= (width < 768 ? 140 : 160), `${name}: iframe starts too low ${metrics.frame.y}`);
    assert.ok(metrics.frame.bottom <= height + 1, `${name}: frame overflows viewport`);
    assert.ok(metrics.footer.bottom <= height + 1, `${name}: footer overflows viewport`);
    assert.ok(metrics.frame.y >= metrics.toolbar.bottom - 1, `${name}: toolbar overlaps iframe`);
    if (width < 768) {
      await page.getByRole("link", { name: "Motyw ↗" }).waitFor();
      await page.getByRole("link", { name: "Otwórz Jeverson w pełnym ekranie" }).waitFor();
    }
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
    console.log(JSON.stringify({ name, status: "PASS", metrics }));
    await page.close();
  }
} finally {
  await browser.close();
}
