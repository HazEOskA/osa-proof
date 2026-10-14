import test from "node:test";
import assert from "node:assert/strict";
import { createMastraOsaTool } from "../integrations/mastra/adapter.mjs";
const mission = { mission_id: "m-1", team_id: "t-1", organization_id: "org-1" };
const args = { mastraRunId: "mr", toolCallId: "tc", toolName: "osa", input: { task: "fixture" } };
function make({ overrides = {}, verifyReceipt = async () => true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const p = new URL(url).pathname; calls.push(p);
    const data = overrides[p] ?? (p === "/session" ? { identity: { organization_id: "org-1" } } : p === "/missions" ? mission : p === "/missions/m-1" ? { mission, run: { run_id: "r", execution_id: "e" }, mission_receipt: { receipt_sha256: "sha256:mission" } } : p.endsWith("/receipt")
      ? { schema: "osa.mission_receipt.v1", mission_id: "m-1", receipt_sha256: "sha256:mission", verification_receipt_sha256: "sha256:proof" }
      : { run_id: "r", execution_id: "e", verdict: "VERIFIED", proof: { run_id: "r", execution_id: "e", mission_id: "m-1", verdict: "VERIFIED", receipt_sha256: "sha256:proof" }, final_output: "ok" });
    return data?.status ? { ok: false, status: data.status } : { ok: true, status: 200, json: async () => data };
  };
  return { calls, run: createMastraOsaTool({ apiBaseUrl: "https://osa.invalid", token: "t", fetchImpl, missionFactory: () => mission, verifyReceipt }) };
}
test("valid bound receipt and external verifier callback", async () => {
  const x = make(); const r = await x.run(args);
  assert.equal(r.verification, "VERIFIER_CALLBACK_APPROVED");
  assert.deepEqual(x.calls, ["/session", "/missions", "/missions/m-1/run", "/missions/m-1/receipt", "/missions/m-1"]);
});
test("rejects failed run", async () => {
  const x = make({ overrides: { "/missions/m-1/run": { verdict: "FAILED" } } });
  await assert.rejects(x.run(args), e => e.code === "RUN_NOT_VERIFIED");
});
test("rejects cross-mission receipt", async () => {
  const x = make({ overrides: { "/missions/m-1/receipt": { schema: "osa.mission_receipt.v1", mission_id: "other" } } });
  await assert.rejects(x.run(args), e => e.code === "RECEIPT_MISMATCH");
});
test("rejects proof execution mismatch", async () => {
  const x = make({ overrides: { "/missions/m-1/run": { run_id: "r", execution_id: "e", verdict: "VERIFIED", proof: { run_id: "r", execution_id: "wrong", mission_id: "m-1", verdict: "VERIFIED" } } } });
  await assert.rejects(x.run(args), e => e.code === "RUN_NOT_VERIFIED");
});
test("fails closed when verifier denies", async () => {
  const x = make({ verifyReceipt: async () => false });
  await assert.rejects(x.run(args), e => e.code === "VERIFIER_FAILED");
});
test("fails closed when verifier throws", async () => {
  const x = make({ verifyReceipt: async () => { throw Error("bad"); } });
  await assert.rejects(x.run(args), e => e.code === "VERIFIER_FAILED");
});
test("409 duplicate mission never reexecutes", async () => {
  const x = make({ overrides: { "/missions": { status: 409 } } });
  await assert.rejects(x.run(args), e => e.code === "DUPLICATE_MISSION");
  assert.deepEqual(x.calls, ["/session", "/missions"]);
});
test("rejects non-HTTPS", () => assert.throws(() => createMastraOsaTool({ apiBaseUrl: "http://localhost", token: "t", missionFactory: () => mission, verifyReceipt: () => true }), e => e.code === "CONFIG"));
test("requires verifier callback", () => assert.throws(() => createMastraOsaTool({ apiBaseUrl: "https://osa.invalid", token: "t", missionFactory: () => mission }), e => e.code === "CONFIG"));

test("rejects persisted record with wrong execution id", async () => {
  const x = make({ overrides: { "/missions/m-1": { mission, run: { run_id: "r", execution_id: "foreign" }, mission_receipt: { receipt_sha256: "sha256:mission" } } } });
  await assert.rejects(x.run(args), e => e.code === "RECORD_MISMATCH");
});

test("missing input fails before any network request", async () => {
  const x = make();
  await assert.rejects(x.run({ mastraRunId: "mr", toolCallId: "tc", toolName: "osa" }), e => e.code === "INVALID_INPUT");
  assert.deepEqual(x.calls, []);
});

test("tenant mismatch stops before creating mission", async () => {
  const x = make({ overrides: { "/session": { identity: { organization_id: "other-org" } } } });
  await assert.rejects(x.run(args), e => e.code === "TENANT_SCOPE_DENIED");
  assert.deepEqual(x.calls, ["/session"]);
});
