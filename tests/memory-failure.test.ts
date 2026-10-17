import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { BrainControlPlane } from "../packages/brain/src";
import type { MemoryWriteReceipt, WritableBrainMemory } from "../packages/contracts/src";
import { digest } from "../packages/proof-core/src/canonical";
import { ExecutorRegistry } from "../packages/runtime/src";

test("HTTP memory: a confirmed statement receipt survives a later recall failure", async () => {
  let saved: MemoryWriteReceipt | undefined;
  // Deliberate MemoryService boundary fixture; the adapter/read-back contract has separate tests.
  const memory: WritableBrainMemory = {
    id: "failure-fixture", binding: { organization_id: "org-test", project_id: "osa-proof" },
    async probe() { return { brain_id: "OsaBrain", ledger_valid: true }; },
    async recall() { throw new Error("upstream-private-error"); },
    async readEvent() { throw new Error("unused"); },
    async observe(event) {
      const receipt = { schema: "osa.memory_write_receipt.v1" as const, scope: event.scope, brain_id: "OsaBrain",
        event_sha256: event.event_sha256, document_id: randomUUID(), document_revision: 1, content_sha256: digest(event) };
      saved = { ...receipt, receipt_sha256: digest(receipt) }; return saved;
    },
  };
  const state = new ApiState(undefined, undefined, undefined, "session", undefined, new BrainControlPlane(undefined, memory));
  const member = state.sessions.create({ identity_id: "test-member", provider: "github", subject: "github:12345", verified: true,
    display_name: "Test", organization_id: "org-test", project_ids: ["osa-proof"], roles: [] });
  const server = createApiServer(new ExecutorRegistry(), state);
  const originalKey = process.env.NVIDIA_API_KEY; process.env.NVIDIA_API_KEY = "test-provider";
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(base + "/nvidia/fleet-chat", { method: "POST", headers: { authorization: "Bearer " + member.token },
      body: JSON.stringify({ prompt: "Zapamiętaj kolor bursztynowy", remember: true, conversation_id: randomUUID() }) });
    assert.equal(response.status, 502);
    const body = await response.json() as { error: string; code: string; memory_write: MemoryWriteReceipt };
    assert.equal(body.code, "MEMORY_OPERATION_FAILED"); assert.match(body.error, /został potwierdzony/);
    assert.ok(!body.error.includes("upstream-private-error")); assert.ok(saved);
    assert.deepEqual(body.memory_write, saved);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    if (originalKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalKey;
  }
});
