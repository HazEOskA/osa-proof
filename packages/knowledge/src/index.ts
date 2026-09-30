import { digest, sha256Hex } from "../../proof-core/src";

// Knowledge: retrieval over sources where every result cites a content-addressed source.
//
// Rules:
// 1. A document is split into chunks on paragraph boundaries; core computes chunk_sha256 over the exact chunk
//    text and document_sha256 over the document's chunk list. Stored text is what the digests commit to.
// 2. Retrieval is lexical BM25: deterministic, no model, the same query over the same collection always gives
//    the same results in the same order.
// 3. Every result carries doc_id, chunk index, chunk_sha256 and document_sha256, so an answer that uses it can
//    cite a source anyone can re-check. Each search is sealed with retrieval_sha256.
// 4. A document id is immutable: the same id with different text is refused; add a new id instead.

export class KnowledgeError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "conflict" = "invalid") {
    super(message);
    this.name = "KnowledgeError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const MAX_CHUNK_CHARS = 800;
export const MAX_DOCUMENT_CHARS = 200_000;

export interface Chunk { index: number; text: string; chunk_sha256: string }
export interface KnowledgeDocument {
  collection: string; doc_id: string; title: string; source: string;
  chunks: Chunk[]; document_sha256: string; created_at: string;
}
export interface SearchHit {
  doc_id: string; title: string; source: string; chunk_index: number; text: string;
  chunk_sha256: string; document_sha256: string; score: number;
}
export interface Retrieval { collection: string; query: string; k: number; hits: SearchHit[]; retrieval_sha256: string }

// Paragraphs, then hard-wrapped at MAX_CHUNK_CHARS on whitespace. Deterministic.
export function chunkText(text: string): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    let rest = para;
    while (rest.length > MAX_CHUNK_CHARS) {
      let cut = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
      if (cut < MAX_CHUNK_CHARS / 2) cut = MAX_CHUNK_CHARS;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
}

function documentDigest(doc: Pick<KnowledgeDocument, "collection" | "doc_id" | "title" | "source" | "chunks">): string {
  return digest({ collection: doc.collection, doc_id: doc.doc_id, title: doc.title, source: doc.source, chunks: doc.chunks.map((c) => ({ index: c.index, chunk_sha256: c.chunk_sha256 })) });
}

export function verifyDocument(doc: KnowledgeDocument): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  doc.chunks.forEach((c, i) => {
    if (c.index !== i) errors.push(`chunk ${i} has index ${c.index}`);
    if (sha256Hex(c.text) !== c.chunk_sha256) errors.push(`chunk ${i} text does not match chunk_sha256`);
  });
  if (documentDigest(doc) !== doc.document_sha256) errors.push("document_sha256 does not match the document");
  return { ok: errors.length === 0, errors };
}

// A hit is a valid citation when its text hashes to chunk_sha256 and that chunk is in the cited document.
export function verifyCitation(hit: SearchHit, doc: KnowledgeDocument): boolean {
  const chunk = doc.chunks[hit.chunk_index];
  return !!chunk && doc.doc_id === hit.doc_id && doc.document_sha256 === hit.document_sha256 &&
    chunk.chunk_sha256 === hit.chunk_sha256 && sha256Hex(hit.text) === hit.chunk_sha256;
}

export class KnowledgeStore {
  private readonly collections = new Map<string, Map<string, KnowledgeDocument>>();
  constructor(private readonly clock: () => Date = () => new Date()) {}

  add(collection: string, input: { doc_id: string; title?: string; source?: string; text: string }): KnowledgeDocument {
    if (typeof collection !== "string" || !ID.test(collection)) throw new KnowledgeError(`collection must match ${ID.source}`);
    if (typeof input?.doc_id !== "string" || !ID.test(input.doc_id)) throw new KnowledgeError(`doc_id must match ${ID.source}`);
    if (typeof input.text !== "string" || !input.text.trim()) throw new KnowledgeError("text is required");
    if (input.text.length > MAX_DOCUMENT_CHARS) throw new KnowledgeError(`a document holds at most ${MAX_DOCUMENT_CHARS} characters`);
    const chunks = chunkText(input.text).map((text, index) => ({ index, text, chunk_sha256: sha256Hex(text) }));
    const base = { collection, doc_id: input.doc_id, title: String(input.title ?? input.doc_id), source: String(input.source ?? ""), chunks };
    const document_sha256 = documentDigest(base);
    const docs = this.collections.get(collection) ?? new Map<string, KnowledgeDocument>();
    const existing = docs.get(input.doc_id);
    if (existing) {
      if (existing.document_sha256 === document_sha256) return structuredClone(existing);
      throw new KnowledgeError(`document ${input.doc_id} exists with different content; use a new doc_id`, "conflict");
    }
    const doc: KnowledgeDocument = { ...base, document_sha256, created_at: this.clock().toISOString() };
    docs.set(doc.doc_id, doc);
    this.collections.set(collection, docs);
    return structuredClone(doc);
  }

  get(collection: string, docId: string): KnowledgeDocument {
    const doc = this.collections.get(collection)?.get(docId);
    if (!doc) throw new KnowledgeError(`document not found: ${collection}/${docId}`, "not_found");
    return structuredClone(doc);
  }

  list(): Array<{ collection: string; documents: number; chunks: number }> {
    return [...this.collections.entries()].map(([collection, docs]) => ({
      collection, documents: docs.size, chunks: [...docs.values()].reduce((n, d) => n + d.chunks.length, 0),
    })).sort((a, b) => (a.collection < b.collection ? -1 : 1));
  }

  documents(collection: string): Array<Omit<KnowledgeDocument, "chunks"> & { chunk_count: number }> {
    const docs = this.collections.get(collection);
    if (!docs) throw new KnowledgeError(`collection not found: ${collection}`, "not_found");
    return [...docs.values()].map(({ chunks, ...rest }) => ({ ...rest, chunk_count: chunks.length })).sort((a, b) => (a.doc_id < b.doc_id ? -1 : 1));
  }

  // BM25 (k1 = 1.2, b = 0.75) over chunks. Ties break on doc_id then chunk index, so order is stable.
  search(collection: string, query: string, k = 5): Retrieval {
    const docs = this.collections.get(collection);
    if (!docs) throw new KnowledgeError(`collection not found: ${collection}`, "not_found");
    if (typeof query !== "string" || !query.trim()) throw new KnowledgeError("query is required");
    const limit = Math.max(1, Math.min(Number.isInteger(k) ? k : 5, 20));
    const terms = [...new Set(tokenize(query))];
    const units = [...docs.values()].flatMap((d) => d.chunks.map((c) => ({ d, c, tokens: tokenize(c.text) })));
    const N = units.length;
    const avg = units.reduce((n, u) => n + u.tokens.length, 0) / Math.max(1, N);
    const df = new Map(terms.map((t) => [t, units.filter((u) => u.tokens.includes(t)).length]));
    const scored = units.map((u) => {
      let score = 0;
      for (const t of terms) {
        const tf = u.tokens.filter((x) => x === t).length;
        if (!tf) continue;
        const n = df.get(t)!;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((tf * 2.2) / (tf + 1.2 * (1 - 0.75 + (0.75 * u.tokens.length) / avg)));
      }
      return { u, score: Math.round(score * 1e6) / 1e6 };
    }).filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.u.d.doc_id < b.u.d.doc_id ? -1 : a.u.d.doc_id > b.u.d.doc_id ? 1 : a.u.c.index - b.u.c.index))
      .slice(0, limit);
    const hits: SearchHit[] = scored.map(({ u, score }) => ({
      doc_id: u.d.doc_id, title: u.d.title, source: u.d.source, chunk_index: u.c.index, text: u.c.text,
      chunk_sha256: u.c.chunk_sha256, document_sha256: u.d.document_sha256, score,
    }));
    const retrieval_sha256 = digest({ collection, query, k: limit, hits: hits.map((h) => ({ doc_id: h.doc_id, chunk_index: h.chunk_index, chunk_sha256: h.chunk_sha256, score: h.score })) });
    return { collection, query, k: limit, hits, retrieval_sha256 };
  }
}
