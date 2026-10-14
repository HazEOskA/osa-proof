import test from "node:test";
import assert from "node:assert/strict";
import { createMastraOsaTool, OsaAdapterError } from "../integrations/mastra/adapter.mjs";
const mission = { mission_id: "m-1", team_id: "t-1" };
const args = { mastraRunId: "mastra-1", toolCallId: "call-1", toolName: "osa_execute", input: { task: "fixture" } };
const make = (overrides = {}) => {
  const calls = [];
  const handler = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const body = path === "/missions" ? mission : path.endsWith("/receipt")
      ? { schema: "osa.mission_receipt.v1", mission_id: "m-1", receipt_sha256: "sha256:fixture" }
      : { run_id: "run-1", execution_id: "exec-1", verdict: "VERIFIED", final_output: "ok" };
    const chosen = overrides[path] ?? body;
    return { ok: true, status: 200, json: async () => chosen };
  };
  return { calls, execute: createMastraOsaTool({ apiBaseUrl: "https://osa.invalid", token: "test-token", fetchImpl: handler, missionFactory: () => mission }) };
};
test("correlates one authorized fixture mission without claiming independent verification", async () => {
  const { calls, execute } = make();
  const result = await execute(args);
  assert.equal(result.osa_execution_id, "exec-1");
  assert.equal(result.verification, "CORRELATED_NOT_INDEPENDENTLY_VERIFIED");
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ["/missions", "/missions/m-1/run", "/missions/m-1/receipt"]);
  assert.ok(calls.every(c => c.init.headers.authorization === "Bearer test-token"));
});
test("fails closed for non-verified run", async () => {
  const { execute } = make({ "/missions/m-1/run": { run_id: "r", execution_id: "e", verdict: "FAILED" } });
  await assert.rejects(execute(args), e => e instanceof OsaAdapterError && e.code === "RUN_NOT_VERIFIED");
});
test("fails closed for receipt bound to another mission", async () => {
  const { execute } = make({ "/missions/m-1/receipt": { schema: "osa.mission_receipt.v1", mission_id: "other" } });
  await assert.rejects(execute(args), e => e.code === "RECEIPT_MISMATCH");
});
test("rejects non-HTTPS OSA endpoint", () => {
  assert.throws(() => createMastraOsaTool({ apiBaseUrl: "http://localhost", token: "t", missionFactory: () => mission }), e => e.code === "CONFIG");
});
