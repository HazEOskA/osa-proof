import type { EvidenceRecord } from "../../contracts/src";
import { sha256Hex } from "./canonical";

// EvidenceCollector commits to UTF-8 bytes but deliberately does not retain them.
// Call only after verifying the enclosing MissionRecord; this is not source attestation.
export function verifyEvidenceContents(evidence: EvidenceRecord[], contents: unknown): { checked: number } {
  if (!contents || typeof contents !== "object" || Array.isArray(contents)) throw new Error("ARTIFACT_CONTENT_MAP_INVALID");
  const supplied = contents as Record<string, unknown>;
  const ids = new Set<string>();
  let checked = 0;
  for (const item of evidence) {
    if (item.content_sha256 === undefined && item.content_bytes === undefined) continue;
    if (ids.has(item.evidence_id) || typeof item.content_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.content_sha256) ||
        !Number.isSafeInteger(item.content_bytes) || item.content_bytes! < 0) throw new Error("ARTIFACT_COMMITMENT_INVALID");
    ids.add(item.evidence_id);
    if (!Object.hasOwn(supplied, item.evidence_id) || typeof supplied[item.evidence_id] !== "string") throw new Error("ARTIFACT_CONTENT_MISSING");
    const bytes = Buffer.from(supplied[item.evidence_id] as string, "utf8");
    if (bytes.length !== item.content_bytes || sha256Hex(bytes) !== item.content_sha256) throw new Error("ARTIFACT_CONTENT_MISMATCH");
    checked++;
  }
  if (Object.keys(supplied).some(id => !ids.has(id))) throw new Error("ARTIFACT_CONTENT_UNEXPECTED");
  return { checked };
}
