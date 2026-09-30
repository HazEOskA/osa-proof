// Re-implements osa-proof canonical JSON + verifyProofReceipt in the browser (SHA-256 via SubtleCrypto).
import type { Run } from "../data/types";

export function canon(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canon(x))).join(",")}]`;
  switch (typeof v) {
    case "boolean": case "string": case "number": return JSON.stringify(v);
    case "object": {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
    }
    default: throw new Error("unsupported value");
  }
}
export async function sha256(s: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("SubtleCrypto unavailable (needs https or localhost)");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const dig = (v: unknown) => sha256(canon(v));
const without = <T extends object>(o: T, k: string) => { const c = { ...(o as Record<string, unknown>) }; delete c[k]; return c; };

export interface Check { id: string; label: string; expected: string; observed: string; ok: boolean }

export async function verifyRun(run: Run): Promise<Check[]> {
  const p = run.proof;
  const out: Check[] = [];
  const push = (id: string, label: string, expected: string, observed: string) => out.push({ id, label, expected, observed, ok: expected === observed });
  const body = without(without(p, "proof_id"), "receipt_sha256");
  push("receipt", "receipt_sha256 = digest(receipt body)", p.receipt_sha256, await dig(body));
  push("proof_id", "proof_id commits to receipt_sha256", p.proof_id, `proof_${p.receipt_sha256}`);
  for (const e of run.evidence) push(`ev:${e.evidence_id}`, `evidence #${e.sequence} · ${e.kind}`, p.evidence_refs.find((r) => r.evidence_id === e.evidence_id)?.evidence_sha256 ?? "missing", await dig(without(e, "evidence_sha256")));
  push("root", "evidence_root = digest(evidence_refs)", p.evidence_root, await dig(p.evidence_refs));
  for (const o of run.observations) push(`ob:${o.observation_id}`, `observation #${o.sequence} · ${o.check}`, p.observation_refs.find((r) => r.observation_id === o.observation_id)?.observation_sha256 ?? "missing", await dig(without(o, "observation_sha256")));
  push("final", "final_output_sha256 = digest(final_output)", String(p.final_output_sha256), await dig(run.final_output));
  const bound = run.evidence.every((e) => canon(e.binding) === canon(p.binding));
  push("binding", "every evidence record bound to receipt binding", "true", String(bound));
  return out;
}
