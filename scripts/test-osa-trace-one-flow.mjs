import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const out = "artifacts/osa-trace-one-flow";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.OSA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OSA_CHROMIUM_EXECUTABLE } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  for (const [name, width, height] of [["android-390x844", 390, 844], ["desktop-1440x900", 1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const opened = await page.goto("http://127.0.0.1:3100", { waitUntil: "domcontentloaded" });
    assert.equal(opened.status(), 200);
    await page.locator('section[aria-label="Uruchamianie"]').getByRole("button", { name: "Czat floty agentów", exact: true }).click();
    await page.getByTestId("osa-native-chat").waitFor();
    const pending = page.waitForResponse(r => r.url().endsWith("/api/trace-probe") && r.request().method() === "POST");
    await page.getByRole("button", { name: "ŚLEDZENIE OSA", exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200);
    const bundle = await response.json();
    assert.equal(bundle.task_status, "EXECUTED");
    assert.equal(bundle.proof_verdict, "VERIFIED");
    assert.equal(bundle.verification_scope, "IN_PROCESS_STATE_AND_RUNTIME_EVIDENCE_NOT_HTTP");
    assert.deepEqual(bundle.steps.map(s => s.http_status), [null, null]);
    assert.deepEqual(bundle.steps.map(s => s.status), ["OK", "OK"]);
    assert.deepEqual(bundle.steps.map(s => s.source), ["IN_PROCESS_API_STATE", "IN_PROCESS_API_STATE"]);
    assert.equal(bundle.run.execution_id, bundle.execution_id);
    await page.getByTestId("osa-message").filter({ hasText: bundle.execution_id }).waitFor();
    await page.getByRole("button", { name: "Inspektor", exact: true }).click();
    const inspector = page.getByTestId("osa-inspector");
    await inspector.waitFor();
    assert.match(await inspector.innerText(), /ZWERYFIKOWANO/);
    assert.ok((await inspector.innerText()).includes(bundle.execution_id));
    await page.screenshot({ path: `${out}/${name}-task.png`, fullPage: false });
    await inspector.getByRole("button", { name: "Dowody ↗", exact: true }).click();
    await page.getByRole("heading", { name: "WYKONANIE ZWERYFIKOWANE", exact: true }).waitFor();
    await page.getByText(/\d+\/\d+ MATCH/, { exact: true }).waitFor();
    await page.getByText(bundle.execution_id, { exact: true }).waitFor();
    await page.screenshot({ path: `${out}/${name}-proof.png`, fullPage: false });
    await page.getByRole("button", { name: "Symuluj naruszenie", exact: true }).click();
    await page.getByText(/\d+ MISMATCH/, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Cofnij zmianę testową", exact: true }).click();
    await page.getByText(/\d+\/\d+ MATCH/, { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "HORIZONTAL_OVERFLOW");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ view: name, result: "PASS", execution_id: bundle.execution_id,
      real_osa_runtime: true, endpoint_responses: "IN_PROCESS_API_STATE", model_requests: 0,
      browser_receipt_verification: true, tampering_rejected: true }));
    await page.close();
  }
} finally { await browser.close(); }
