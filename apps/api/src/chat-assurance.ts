import type { RunVerdict } from "../../../packages/contracts/src";
import { evaluateClaimEvidenceV2, type ClaimCandidateV2, type ClaimFindingV2, type ClaimVerificationV2 } from "../../../packages/proof-core/src";

/** v2 keeps execution integrity distinct from the factual validity of text. */
export type ContentAssurance = {
  schema:"osa.chat_content_assurance.v2";
  verdict:"SUPPORTED"|"CONTRADICTED"|"UNKNOWN";
  execution_verdict:RunVerdict;
  claim_verification:ClaimVerificationV2;
  verified_scope:string[];
  not_verified:string[];
  disclosure_pl:string;
};
export function assessChatContent(
  executionVerdict:RunVerdict,
  input: {
    candidates:readonly ClaimCandidateV2[];
    findings:readonly ClaimFindingV2[];
    evidenceRefs:readonly {evidence_id:string;evidence_sha256:string}[];
    /** Server-only verifier IDs; model/user must never supply them. */
    trustedVerifiers:readonly string[];
  } = {candidates:[],findings:[],evidenceRefs:[],trustedVerifiers:[]}
):ContentAssurance {
  const checked=evaluateClaimEvidenceV2(input.candidates,input.findings,
    input.evidenceRefs,input.trustedVerifiers);
  // A verified execution is NOT an automatic verification of the output text.
  return {
    schema:"osa.chat_content_assurance.v2",
    verdict:checked.verdict,
    execution_verdict:executionVerdict,
    claim_verification:checked,
    verified_scope:checked.claims.filter(c=>c.verdict==="SUPPORTED").map(c=>c.claim_id),
    not_verified:checked.coverage==="NONE"?["CLAIMS_NOT_INDEPENDENTLY_EXTRACTED_OR_VERIFIED"]:
      checked.claims.filter(c=>c.verdict==="UNKNOWN").map(c=>c.claim_id),
    disclosure_pl:checked.coverage==="NONE"
      ?"Treść NIEZWERYFIKOWANA: nie przeprowadzono niezależnej oceny twierdzeń. APR potwierdza wykonanie, nie prawdziwość odpowiedzi."
      :"Oceniono tylko jawnie wskazane twierdzenia i powiązane dowody. Pozostała treść odpowiedzi NIEZWERYFIKOWANA.",
  };
}
