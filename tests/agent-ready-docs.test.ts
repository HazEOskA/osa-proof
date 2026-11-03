import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { strict as assert } from "node:assert";

// The browser-facing exporter is plain JS in apps/web/docs and requires no new dependencies.
// npm test compiles this wrapper; the harness runs against the real portal file.
test("Agent-Ready Docs v1 — statyczny portal i semantyka Copy page/section", () => {
  const script = resolve(process.cwd(), "scripts", "test-agent-ready-docs.cjs");
  const run = spawnSync(process.execPath, [script], {
    cwd: process.cwd(), encoding: "utf8", timeout: 30000,
  });
  assert.equal(run.status, 0, "Agent-Ready Docs test failed:\n" + (run.stdout || "") + "\n" + (run.stderr || ""));
});
