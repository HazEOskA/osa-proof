import test from "node:test";
import assert from "node:assert/strict";
import { createOsaDelegationTool } from "../integrations/mastra/mastra-tool.mjs";

test("real Mastra SDK creates approval-gated OSA delegation tool", () => {
  const tool = createOsaDelegationTool({
    apiBaseUrl: "https://osa.invalid",
    token: "fixture-session",
    missionFactory: () => ({ mission_id: "fixture" }),
    verifyReceipt: async () => true,
  });
  assert.equal(tool.id, "osa-verified-delegation");
  assert.equal(tool.requireApproval, true);
  assert.equal(typeof tool.execute, "function");
  assert.equal(tool.inputSchema.safeParse({ task: "verify mission" }).success, true);
  assert.equal(tool.inputSchema.safeParse({ task: "" }).success, false);
});
test("SDK tool rejects execution without trusted correlation context", async () => {
  const tool = createOsaDelegationTool({
    apiBaseUrl: "https://osa.invalid",
    token: "fixture-session",
    missionFactory: () => { throw new Error("SHOULD_NOT_RUN"); },
    verifyReceipt: async () => true,
  });
  await assert.rejects(
    Promise.resolve().then(() => tool.execute({ task: "verify mission" }, {})),
    /OSA_CORRELATION_CONTEXT_MISSING/
  );
});
