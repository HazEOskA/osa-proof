import { sha256Hex } from "./canonical";

/** Universal *claim-level* evidence contract. No domain patterns or model-only truth claims. */
export type ClaimVerdictV2 = "SUPPORTED" | "CONTRADICTED" | "UNKNOWN";
export interface ClaimCandidateV2 {
  claim_id: string;
  statement: string;
}
export interface ClaimFindingV2 {
  claim_id: string;
  statement_sha256: string;
  evidence_id: string;
  evidence_sha256: string;
  verifier_id: string;
  relation: "SUPPORTS" | "CONTRADICTS";
}
export interface ClaimAssessmentV2 {
  claim_id: string;
  statement_sha256: string;
  verdict: ClaimVerdictV2;
  evidence_ids: string[];
  reason: "VERIFIER_SUPPORT" | "VERIFIER_CONTRADICTION" | "NO_TRUSTED_EVIDENCE" | "CONFLICTING_EVIDENCE";
}
export interface ClaimVerificationV2 {
  schema: "osa.claim_verification.v2";
  verdict: ClaimVerdictV2;
  coverage: "NONE" | "EXPLICIT_CLAIMS_ONLY";
  claims: ClaimAssessmentV2[];
  limitations: string[];
}

/**
 * Caller MUST pass findings emitted by server-side independent verifiers only.
 * The trusted-verifier allowlist MUST be provisioned by the host, never by the
 * model, prompt, retrieved text or client. A matching SHA verifies binding /
 * integrity, not the underlying fact, the verifier's identity, or completeness.
 *
 * No findings and no explicit claim extraction => UNKNOWN, always.
 * This evaluator never blocks conversations and does not evaluate prose itself.
 */
export function evaluateClaimEvidenceV2(
  candidates: readonly ClaimCandidateV2[],
  findings: readonly ClaimFindingV2[],
  verifiedEvidenceRefs: readonly {evidence_id:string;evidence_sha256:string}[],
  trustedVerifierIds: readonly string[],
): ClaimVerificationV2 {
  if (candidates.length > 100 || findings.length > 500) throw Error("CLAIM_EVALUATION_LIMIT");
  const ids = new Set<string>();
  const refs = new Map(verifiedEvidenceRefs.map(ref=>[ref.evidence_id,ref.evidence_sha256]));
  const trusted = new Set(trustedVerifierIds);
  const claims: ClaimAssessmentV2[] = candidates.map(candidate=>{
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(candidate.claim_id) ||
        typeof candidate.statement!=="string" || !candidate.statement.trim() ||
        candidate.statement.length>8000 || ids.has(candidate.claim_id))
      throw Error("INVALID_CLAIM_CANDIDATE");
    ids.add(candidate.claim_id);
    const statement_sha256=sha256Hex(candidate.statement);
    const matches=findings.filter(f=>f.claim_id===candidate.claim_id &&
      f.statement_sha256===statement_sha256 &&
      trusted.has(f.verifier_id) &&
      /^[a-f0-9]{64}$/.test(f.evidence_sha256) &&
      refs.get(f.evidence_id)===f.evidence_sha256 &&
      (f.relation==="SUPPORTS"||f.relation==="CONTRADICTS"));
    const support=matches.some(f=>f.relation==="SUPPORTS");
    const contradiction=matches.some(f=>f.relation==="CONTRADICTS");
    const verdict:ClaimVerdictV2=support&&contradiction?"UNKNOWN":contradiction?"CONTRADICTED":support?"SUPPORTED":"UNKNOWN";
    const reason:ClaimAssessmentV2["reason"]=support&&contradiction?"CONFLICTING_EVIDENCE":
      contradiction?"VERIFIER_CONTRADICTION":support?"VERIFIER_SUPPORT":"NO_TRUSTED_EVIDENCE";
    return {claim_id:candidate.claim_id,statement_sha256,verdict,
      evidence_ids:[...new Set(matches.map(f=>f.evidence_id))],reason};
  });
  return {
    schema:"osa.claim_verification.v2",
    verdict:claims.length===0?"UNKNOWN":claims.some(c=>c.verdict==="CONTRADICTED")?"CONTRADICTED":
      claims.every(c=>c.verdict==="SUPPORTED")?"SUPPORTED":"UNKNOWN",
    coverage:claims.length===0?"NONE":"EXPLICIT_CLAIMS_ONLY",
    claims,
    limitations:[
      "A claim verdict applies only to explicitly enumerated claims, not every statement in the answer.",
      "Hash matching confirms an evidence reference, not factual truth or verifier authenticity.",
      "No trusted independent findings is UNKNOWN; model output and APR execution success are not factual evidence.",
    ],
  };
}
