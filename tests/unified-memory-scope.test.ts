import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { executeUnified, installUnifiedTools } from "../apps/api/src/unified";
import { BrainControlPlane } from "../packages/brain/src";
import { verifyMemoryEvent } from "../packages/brain/src/memory";
import type { AgentExecutor, BrainScope, Identity, MemoryEvent, MemoryWriteReceipt, WritableBrainMemory } from "../packages/contracts/src";
import { canonicalJson, digest, sha256Hex } from "../packages/proof-core/src/canonical";
import { ExecutorRegistry } from "../packages/runtime/src";

const binding = { organization_id: "org-existing", project_id: "project-existing-production" };
const identity: Identity = { identity_id: "github_test", provider: "github", subject: "github:12345", display_name: "Test",
  verified: true, roles: ["member"], organization_id: binding.organization_id, project_ids: [binding.project_id] };
const input = () => ({ message: "Oblicz SHA-256 tekstu: scoped", execution_id: "exec_" + randomUUID(),
  organization_id: "browser-forged-org", project_id: "browser-forged-project" });

class CountingRegistry extends ExecutorRegistry {
  executions = 0;
  scopes: Array<{ organization_id: string; project_id: string }> = [];
  override register(ref: string, executor: AgentExecutor): void {
    super.register(ref, context => {
      this.executions++;
      this.scopes.push({ organization_id: context.mission.organization_id, project_id: context.mission.project_id });
      return executor(context);
    });
  }
}

// Explicit memory fixture: these tests verify scope and dispatch, not LIVE persistence.
function memoryFixture() {
  const events: MemoryEvent[] = [];
  const adapter: WritableBrainMemory = {
    id: "test-scoped-memory", binding,
    async recall() { throw Error("Unexpected recall"); },
    async probe() { throw Error("Unexpected probe"); },
    async readEvent() { throw Error("Unexpected read"); },
    async observe(event) {
      verifyMemoryEvent(event);
      assert.equal(event.scope.organization_id, binding.organization_id);
      assert.equal(event.scope.project_id, binding.project_id);
      events.push(structuredClone(event));
      const body = { schema: "osa.memory_write_receipt.v1" as const, scope: event.scope, brain_id: "OsaBrain",
        event_sha256: event.event_sha256, document_id: randomUUID(), document_revision: 1,
        content_sha256: sha256Hex(canonicalJson(event)) };
      return { ...body, receipt_sha256: digest(body) };
    },
  };
  return { adapter, events };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
}
async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("Unified HTTP: existing configured project binds execution, proof and verified memory before dispatch", async () => {
  const memory = memoryFixture(), registry = new CountingRegistry();
  const state = new ApiState(undefined, undefined, undefined, "session", undefined, new BrainControlPlane(undefined, memory.adapter));
  const session = state.sessions.create(identity), server = createApiServer(registry, state);
  try {
    const base = await listen(server);
    const response = await fetch(base + "/unified/execute", { method: "POST", headers: { authorization: "Bearer " + session.token },
      body: JSON.stringify(input()) });
    assert.equal(response.status, 200);
    const result = await response.json() as { status: string; team: typeof binding; mission: BrainScope;
      integrity: { ok: boolean }; run: { proof: { binding: { organization_id: string; project_id: string } } }; memory_write: MemoryWriteReceipt };
    assert.equal(result.status, "EXECUTED"); assert.equal(result.integrity.ok, true);
    assert.deepEqual(registry.scopes, [binding]); assert.equal(registry.executions, 1);
    for (const scope of [result.team, result.mission, result.run.proof.binding, result.memory_write.scope]) {
      assert.equal(scope.organization_id, binding.organization_id); assert.equal(scope.project_id, binding.project_id);
    }
    assert.equal(memory.events.length, 1); assert.equal(memory.events[0].kind, "VERIFIED_RUNTIME");
    assert.equal(memory.events[0].scope.mission_id, result.mission.mission_id);
  } finally { await close(server); }
});

test("Unified HTTP: unauthorized organization/project and developer identity cannot execute a tool or write memory", async () => {
  const memory = memoryFixture(), registry = new CountingRegistry();
  const state = new ApiState(undefined, undefined, undefined, "session", undefined, new BrainControlPlane(undefined, memory.adapter));
  const server = createApiServer(registry, state);
  try {
    const base = await listen(server);
    for (const changes of [{ organization_id: "foreign-org" }, { project_ids: ["foreign-project"] }, { project_ids: undefined },
      { provider: "local-dev" as const }]) {
      const session = state.sessions.create({ ...identity, ...changes });
      const response = await fetch(base + "/unified/execute", { method: "POST", headers: { authorization: "Bearer " + session.token },
        body: JSON.stringify(input()) });
      assert.ok([401, 403].includes(response.status));
    }
    assert.equal(registry.executions, 0); assert.equal(memory.events.length, 0); assert.equal(state.runs.size, 0);
  } finally { await close(server); }
});

test("Unified: no private memory preserves legacy project; invalid explicit scope is rejected before execution", async () => {
  const registry = new CountingRegistry(); installUnifiedTools(registry);
  const result = await executeUnified(input(), "org_dev_local", registry);
  assert.equal(result.status, "EXECUTED"); assert.equal(result.team.project_id, "osa-proof");
  assert.deepEqual(registry.scopes, [{ organization_id: "org_dev_local", project_id: "osa-proof" }]);
  for (const [organization, project] of [["", binding.project_id], [binding.organization_id, ""], [binding.organization_id, " "]])
    await assert.rejects(executeUnified(input(), organization, registry, project), /UNIFIED_SCOPE_INVALID/);
  assert.equal(registry.executions, 1);
});
