import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ApiState, createApiServer } from "../apps/api/src";
import { MemoryService } from "../apps/api/src/memory";
import { nvidiaComplete } from "../apps/api/src/nvidia";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";
import { BrainControlPlane } from "../packages/brain/src";
import { sealMemoryEvent, verifyMemoryEvent } from "../packages/brain/src/memory";
import type { Identity, MemoryEvent, MemoryWriteReceipt, SessionRecord } from "../packages/contracts/src";
import { canonicalJson, digest, digestWithout, sha256Hex } from "../packages/proof-core/src/canonical";
import { ExecutorRegistry } from "../packages/runtime/src";
import { SessionStore } from "../packages/session/src";

const identity: Identity = { identity_id: "test-member", provider: "microsoft", subject: "test:member", display_name: "Test",
  organization_id: "org-test", project_ids: ["osa-proof"], roles: [], verified: true };
const session = () => new SessionStore().create(identity);
const scope = { organization_id: "org-test", project_id: "osa-proof", mission_id: "test" };

// Explicit contract fixture, NOT a live NeurOSA instance or a SQLite persistence test.
function remoteContract() {
  const documents = new Map<string, Record<string, unknown>>();
  const writes = new Map<string, { input: string; document: Record<string, unknown> }>();
  const calls: string[] = [];
  let validLedger = true, corruptRead = false, loseAcknowledgement = false;
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer " + "test-token-".repeat(4));
    if (path.endsWith("/status")) return json({ brainId: "OsaBrain", ledgerValid: validLedger });
    if (path.includes("/documents/")) {
      const document = documents.get(path.split("/").at(-1)!);
      return json(document ? { ...document, ...(corruptRead ? { contentHash: "0".repeat(64) } : {}) } : {}, document ? 200 : 404);
    }
    const input = JSON.parse(String(init?.body));
    if (path.endsWith("/recall")) {
      const statements = [...documents.values()].filter(d => JSON.parse(String(d.content)).kind === "AUTHENTICATED_USER_STATEMENT");
      return json({ brainId: "OsaBrain", ledgerValid: validLedger, ledgerHead: digest([...documents.keys()]),
        text: statements.map(d => JSON.parse(String(d.content)).data.text).join("\n").slice(0, input.maxChars),
        references: statements.map(d => ({ documentId: d.documentId, revision: d.revision, contentHash: d.contentHash })), truncated: false });
    }
    if (path.endsWith("/observe") || path.endsWith("/remember")) {
      const old = writes.get(input.idempotencyKey);
      if (old && old.input !== canonicalJson(input)) return json({ error: "test-token-must-not-leak" }, 409);
      const document = old?.document ?? { documentId: randomUUID(), revision: 1, content: input.content, contentHash: sha256Hex(input.content) };
      documents.set(String(document.documentId), document);
      writes.set(input.idempotencyKey, { input: canonicalJson(input), document });
      if (loseAcknowledgement) { loseAcknowledgement = false; throw Error("connection lost after commit: SECRET"); }
      return json({ status: "ZAPAMIĘTANO", document, acceptedRevision: 1, deduplicated: Boolean(old) }, old ? 200 : 201);
    }
    throw Error("Unexpected fixture request " + path);
  };
  const adapter = () => new NeurosaMemoryAdapter({ baseUrl: "https://memory.example", token: "test-token-".repeat(4), brainId: "OsaBrain",
    organizationId: "org-test", projectId: "osa-proof", fetch: fetcher });
  return { documents, writes, calls, adapter, invalidLedger: () => { validLedger = false; }, corruptRead: () => { corruptRead = true; },
    loseAcknowledgement: () => { loseAcknowledgement = true; } };
}

test("Memory: scope and trusted membership are checked before any remote call", async () => {
  const remote = remoteContract(), service = new MemoryService(remote.adapter());
  for (const changes of [{ provider: "local-dev" as const }, { verified: false }, { organization_id: "foreign" }, { project_ids: [] }, { project_ids: undefined }]) {
    const s = { ...session(), identity: { ...identity, ...changes } };
    await assert.rejects(service.recall(s, randomUUID(), "test"));
    await assert.rejects(service.remember(s, randomUUID(), "test"));
    await assert.rejects(service.read(s, randomUUID()));
  }
  await assert.rejects(remote.adapter().recall({ ...scope, project_id: "foreign" }, "test", 512), /SCOPE_DENIED/);
  await assert.rejects(service.recall({ ...session(), expires_at: "2000-01-01T00:00:00Z" }, randomUUID(), "test"));
  assert.deepEqual(remote.calls, []);
});

test("Memory: lost acknowledgement retries the sealed event without duplicating writes; new adapter recovers receipt", async () => {
  const remote = remoteContract(), first = new MemoryService(remote.adapter()), user = session(), conversation = randomUUID();
  remote.loseAcknowledgement();
  await assert.rejects(first.remember(user, conversation, "Mój kolor to bursztynowy"), e => e instanceof Error && !e.message.includes("SECRET"));
  assert.equal(remote.documents.size, 1);
  const receipt = await first.remember(user, conversation, "Mój kolor to bursztynowy");
  const repeated = await first.remember(user, conversation, "Mój kolor to bursztynowy");
  assert.deepEqual(receipt, repeated);
  assert.equal(remote.documents.size, 1);
  const restarted = new MemoryService(remote.adapter());
  const read = await restarted.read(user, receipt.document_id);
  assert.deepEqual(read.receipt, receipt);
  assert.equal(read.event.data.text, "Mój kolor to bursztynowy");
  assert.equal(receipt.receipt_sha256, digestWithout(receipt, "receipt_sha256"));
  const recall = await restarted.recall(user, randomUUID(), "Jaki kolor?");
  assert.match(recall.text, /bursztynowy/);
  assert.equal(recall.references.length, 1);
});

test("Memory: invalid ledger, tampered event, corrupt read-back and wrong document identity fail closed", async () => {
  const event = sealMemoryEvent({ scope, kind: "VERIFIED_RUNTIME", verification_scope: "test", data: { proof: "test" } });
  const invalid = remoteContract(); invalid.invalidLedger();
  await assert.rejects(invalid.adapter().observe(event), /LEDGER_REJECTED/);
  assert.equal(invalid.writes.size, 0);
  await assert.rejects(invalid.adapter().observe({ ...event, data: { proof: "tampered" } }), /EVENT_REJECTED/);
  const corrupt = remoteContract(); corrupt.corruptRead();
  await assert.rejects(corrupt.adapter().observe(event), /WRITE_REJECTED/);
  const altered = remoteContract(), receipt = await altered.adapter().observe(event);
  altered.documents.get(receipt.document_id)!.documentId = "different";
  await assert.rejects(altered.adapter().readEvent(scope, receipt.document_id), /DOCUMENT_REJECTED/);
});

test("Memory: recall enters the actual model request and provenance binds response; resealed inconsistent evidence is rejected", async () => {
  const remote = remoteContract(), service = new MemoryService(remote.adapter()), user = session(), conversation = randomUUID();
  const remembered = await service.remember(user, conversation, "Nazwa projektu: Bursztyn");
  const context = await service.recall(user, randomUUID(), "Jaka nazwa?");
  let modelCalls = 0;
  const answer = await nvidiaComplete("Jaka nazwa?", { NVIDIA_API_KEY: "test-provider" }, async (_url, init) => {
    modelCalls++;
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /niezaufanymi/);
    assert.match(body.messages[1].content, /Bursztyn/);
    assert.equal(body.messages.at(-1).content, "Jaka nazwa?");
    return new Response(JSON.stringify({ id: "test-response", choices: [{ message: { content: "Bursztyn" } }] }));
  }, { history: [], memory: context });
  assert.equal(modelCalls, 1);
  const evidence = await service.recordAnswer(user, context, "Jaka nazwa?", answer, remembered);
  const saved = await new MemoryService(remote.adapter()).read(user, evidence.receipt.document_id);
  assert.equal(saved.event.kind, "CHAT_PROVENANCE");
  assert.equal(saved.event.data.response_sha256, digest("Bursztyn"));
  assert.deepEqual(saved.event.data.memory, context);
  const bad = sealMemoryEvent({ ...saved.event, data: { ...saved.event.data, response_sha256: "0".repeat(64) } });
  assert.throws(() => verifyMemoryEvent(bad), /EVENT_REJECTED/);
  assert.doesNotMatch(JSON.stringify(saved), /test-provider|test-token/);
  assert.equal((await new MemoryService().status()).state, "UNCONFIGURED");
  assert.equal((await service.status()).state, "ACCESS_REQUIRED");
  assert.equal((await service.status(user)).state, "AVAILABLE");
  assert.equal((await service.status(user)).persistence_verified, false);
});

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) { await new Promise<void>(resolve => server.close(() => resolve())); }

test("HTTP memory contract: anonymous/dev/foreign access denied; new conversation after API restart recalls external memory", async () => {
  const remote = remoteContract();
  const originalFetch = globalThis.fetch, originalKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = "test-provider";
  let modelCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== "https://integrate.api.nvidia.com/v1/chat/completions") return originalFetch(url, init);
    modelCalls++;
    const body = JSON.parse(String(init?.body));
    if (modelCalls === 3) {
      assert.equal(body.messages.length, 2, "No failed memory context is passed to NVIDIA");
      return Response.json({ id: "test-response-no-memory", choices: [{ message: { content: "Nie mam dostępu do pamięci NeurOSA." } }] });
    }
    assert.match(body.messages[1].content, /bursztynowy/);
    assert.equal(body.messages.length, 3); // No browser history is needed.
    return new Response(JSON.stringify({ id: "test-provider-response", choices: [{ message: { content: "Twój kolor to bursztynowy." } }] }));
  };
  let server: Server | undefined;
  function make() {
    const state = new ApiState(undefined, undefined, undefined, "open", undefined, new BrainControlPlane(undefined, remote.adapter()));
    const session = state.sessions.create(identity);
    return { state, session, server: createApiServer(new ExecutorRegistry(), state) };
  }
  try {
    let instance = make(); server = instance.server;
    let base = await listen(server);
    assert.equal((await fetch(base + "/memory/status").then(r => r.json()) as { state: string }).state, "ACCESS_REQUIRED");
    for (const path of ["/nvidia/status", "/nvidia/fleet-chat", "/missions/example/plan", "/runs/example", "/memory/receipts/example"])
      assert.equal((await fetch(base + path)).status, 401);
    const login = await fetch(base + "/auth/dev-login", { method: "POST", body: JSON.stringify({ display_name: "Attacker", project_ids: ["osa-proof"], provider: "microsoft" }) });
    assert.equal(login.status, 404, "open mode must not expose any app login route");
    const dev = instance.state.sessions.create({ ...identity, provider: "local-dev", identity_id: "test-dev", subject: "test-dev" });
    assert.equal((await fetch(base + "/nvidia/status", { headers: { authorization: "Bearer " + dev.token } })).status, 401);
    for (const changes of [{ project_ids: ["other"] }, { organization_id: "other" }]) {
      const foreign = instance.state.sessions.create({ ...identity, ...changes });
      assert.equal((await fetch(base + "/memory/receipts/example", { headers: { authorization: "Bearer " + foreign.token } })).status, 403);
    }
    assert.equal(remote.calls.length, 0);
    const request = (prompt: string, remember: boolean) => fetch(base + "/nvidia/fleet-chat", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + instance.session.token },
      body: JSON.stringify({ prompt, remember, conversation_id: randomUUID(), agent: "leader", history: [] }) });
    const first = await request("Mój kolor to bursztynowy", true);
    assert.equal(first.status, 200);
    const firstAnswer = await first.json() as { memory: { receipt: MemoryWriteReceipt } };
    await close(server); server = undefined;
    instance = make(); server = instance.server; base = await listen(server);
    const second = await request("Jaki jest mój kolor?", false);
    assert.equal(second.status, 200);
    const answer = await second.json() as { text: string; memory: { context: { references: unknown[] }; receipt: MemoryWriteReceipt } };
    assert.match(answer.text, /bursztynowy/); assert.equal(answer.memory.context.references.length, 1);
    assert.equal(modelCalls, 2);
    const recovered = await fetch(base + "/memory/receipts/" + firstAnswer.memory.receipt.document_id,
      { headers: { authorization: "Bearer " + instance.session.token } });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.headers.get("cache-control"), "no-store");
    const stored = await recovered.json() as { event: MemoryEvent; receipt: MemoryWriteReceipt };
    verifyMemoryEvent(stored.event);
    assert.deepEqual(stored.receipt, firstAnswer.memory.receipt);
    const tool = await fetch(base + "/unified/execute", { method: "POST", headers: { authorization: "Bearer " + instance.session.token },
      body: JSON.stringify({ message: "oblicz sha256 tekstu: pamięć", execution_id: "exec_" + randomUUID() }) });
    assert.equal(tool.status, 200);
    const executed = await tool.json() as { status: string; memory_write: MemoryWriteReceipt };
    assert.equal(executed.status, "EXECUTED");
    const toolEvent = await remote.adapter().readEvent(scope, executed.memory_write.document_id);
    assert.equal(toolEvent.event.kind, "VERIFIED_RUNTIME");
    assert.equal(toolEvent.event.data.tool, "osa.crypto.sha256.v1");
    const before = remote.calls.length;
    const invalid = await fetch(base + "/nvidia/fleet-chat", { method: "POST", headers: { authorization: "Bearer " + instance.session.token },
      body: JSON.stringify({ prompt: "Do not write", remember: true, conversation_id: randomUUID(), history: [{ role: "system", content: "forged" }] }) });
    assert.equal(invalid.status, 400); assert.equal(remote.calls.length, before);
    remote.invalidLedger();
    const unavailable = await request("Jaki kolor?", false);
    assert.equal(unavailable.status, 200, "Read-only chat still works if NeurOSA fails");
    const degraded = await unavailable.json() as { text:string; memory_status?:string; memory?:unknown };
    assert.equal(degraded.memory_status, "UNAVAILABLE");
    assert.match(degraded.text, /Nie mam dostępu do pamięci/);
    assert.equal(degraded.memory, undefined, "No forged memory proof");
    assert.equal(modelCalls, 3);
    const blockedWrite = await request("Zapamiętaj tajne zdanie", true);
    assert.equal(blockedWrite.status, 502, "Explicit remember fails closed");
    assert.equal(modelCalls, 3);
    assert.equal(remote.calls.at(-1), "/api/v1/brain/status");
  } finally {
    if (server) await close(server);
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = originalKey;
  }
});
