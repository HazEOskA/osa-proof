import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { chunkText, KnowledgeDocument, KnowledgeError, KnowledgeStore, MAX_CHUNK_CHARS, Retrieval, verifyCitation, verifyDocument } from "../packages/knowledge/src";
import { sha256Hex } from "../packages/proof-core/src";

const CLOCK = () => new Date("2026-09-30T12:00:00.000Z");
function store(): KnowledgeStore {
  const s = new KnowledgeStore(CLOCK);
  s.add("docs", { doc_id: "receipts", title: "Proof receipt", source: "docs/PROOF_PROTOCOL_V2.md", text: "A proof receipt is sealed after the final verdict.\n\nproof_id is proof_ plus receipt_sha256." });
  s.add("docs", { doc_id: "evidence", title: "Evidence", source: "docs/PROOF_PROTOCOL_V2.md", text: "Core computes evidence_sha256 over each record.\n\nExecutor hashes are claims until core recomputes them." });
  s.add("docs", { doc_id: "layers", title: "Layers", text: "Regulated layers fail closed until organization verification exists." });
  return s;
}

test("chunking: paragraphs, long paragraphs wrapped, digests over exact text", () => {
  assert.deepEqual(chunkText("One.\n\n\nTwo.\r\n\r\nThree."), ["One.", "Two.", "Three."]);
  const long = chunkText(("word ".repeat(400)).trim());
  assert.ok(long.length > 1 && long.every((c) => c.length <= MAX_CHUNK_CHARS));
  const doc = store().get("docs", "receipts");
  assert.equal(doc.chunks.length, 2);
  assert.equal(doc.chunks[0].chunk_sha256, sha256Hex(doc.chunks[0].text));
  assert.deepEqual(verifyDocument(doc), { ok: true, errors: [] });
});

test("search: BM25 ranks the relevant source first, deterministic, every hit is a verifiable citation", () => {
  const s = store();
  const r = s.search("docs", "who computes evidence hashes?", 3);
  assert.equal(r.hits[0].doc_id, "evidence");
  assert.deepEqual(s.search("docs", "who computes evidence hashes?", 3), r, "same query, same retrieval");
  for (const h of r.hits) assert.ok(verifyCitation(h, s.get("docs", h.doc_id)), h.doc_id);
  assert.equal(s.search("docs", "zzzz qqqq", 3).hits.length, 0, "no match, no invented hit");
  assert.equal(s.search("docs", "Regulated LAYERS", 1).hits[0].doc_id, "layers", "case-insensitive");
  assert.throws(() => s.search("docs", "  "), KnowledgeError);
  assert.throws(() => s.search("nope", "x"), (e: unknown) => e instanceof KnowledgeError && e.code === "not_found");
});

test("tampering is caught: altered quote, altered chunk, altered document; doc ids are immutable", () => {
  const s = store();
  const hit = s.search("docs", "receipt sealed", 1).hits[0];
  assert.equal(verifyCitation({ ...hit, text: hit.text.replace("sealed", "optional") }, s.get("docs", hit.doc_id)), false);
  const doc = s.get("docs", "receipts");
  const cases: Array<(d: KnowledgeDocument) => void> = [
    (d) => { d.chunks[0].text += "!"; },
    (d) => { d.title = "Forged"; },
    (d) => { d.chunks.pop(); },
  ];
  for (const tamper of cases) { const c = structuredClone(doc); tamper(c); assert.equal(verifyDocument(c).ok, false); }
  assert.equal(s.add("docs", { doc_id: "layers", title: "Layers", text: "Regulated layers fail closed until organization verification exists." }).doc_id, "layers", "same content is idempotent");
  assert.throws(() => s.add("docs", { doc_id: "layers", text: "changed" }), (e: unknown) => e instanceof KnowledgeError && e.code === "conflict");
  assert.throws(() => s.add("docs", { doc_id: "has space", text: "x" }), KnowledgeError);
  assert.throws(() => s.add("docs", { doc_id: "empty", text: "   " }), KnowledgeError);
});

test("HTTP: add documents, list, search with sealed retrieval, fetch the cited document", async () => {
  const server = createApiServer(createDevFixtureRegistry(), new ApiState(undefined, undefined, undefined, "open"), { mode: "fixture" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/knowledge/docs/documents", { doc_id: "receipts", title: "Receipts", text: "A proof receipt is sealed after the verdict." })).status, 201);
    assert.equal((await post("/knowledge/docs/documents", { doc_id: "receipts", text: "changed" })).status, 409);
    assert.deepEqual(await (await fetch(base + "/knowledge")).json(), [{ collection: "docs", documents: 1, chunks: 1 }]);
    const r = (await (await post("/knowledge/docs/search", { query: "sealed receipt", k: 3 })).json()) as Retrieval;
    assert.equal(r.hits.length, 1);
    assert.match(r.retrieval_sha256, /^[0-9a-f]{64}$/);
    const doc = (await (await fetch(`${base}/knowledge/docs/documents/${r.hits[0].doc_id}`)).json()) as KnowledgeDocument;
    assert.ok(verifyCitation(r.hits[0], doc), "citation verifies against the fetched document");
    assert.equal((await fetch(base + "/knowledge/none")).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
