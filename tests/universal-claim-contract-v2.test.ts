import test from "node:test";
import assert from "node:assert/strict";
import { evaluateClaimEvidenceV2, sha256Hex, type ClaimCandidateV2, type ClaimFindingV2 } from "../packages/proof-core/src";

const evidence={evidence_id:"run_verified:evidence:1",evidence_sha256:"a".repeat(64)};
const verifier="osa.independent.verifier.v1";
function candidate(statement:string,id="claim_1"):ClaimCandidateV2{return {claim_id:id,statement};}
function finding(claim:ClaimCandidateV2,relation:"SUPPORTS"|"CONTRADICTS"):ClaimFindingV2{
  return {claim_id:claim.claim_id,statement_sha256:sha256Hex(claim.statement),
    evidence_id:evidence.evidence_id,evidence_sha256:evidence.evidence_sha256,verifier_id:verifier,relation};
}

test("v2: arbitrary answer without claim extraction or independent findings stays UNKNOWN",()=>{
  const report=evaluateClaimEvidenceV2([],[],[],[]);
  assert.equal(report.schema,"osa.claim_verification.v2");
  assert.equal(report.verdict,"UNKNOWN");
  assert.equal(report.coverage,"NONE");
  assert.equal(report.claims.length,0);
});
test("v2: no independently verified fact => UNKNOWN in law, code, business, history",()=>{
  const claims=["Prawo kraju X ma zastosowanie.","Testy kodu przeszły.","Kampania jest rentowna.","Wydarzenie miało miejsce w 1923."]
    .map((statement,index)=>candidate(statement,"claim_"+index));
  const report=evaluateClaimEvidenceV2(claims,[],[evidence],[verifier]);
  assert.equal(report.verdict,"UNKNOWN");
  assert.equal(report.coverage,"EXPLICIT_CLAIMS_ONLY");
  assert.deepEqual(report.claims.map(x=>x.verdict),["UNKNOWN","UNKNOWN","UNKNOWN","UNKNOWN"]);
});
test("v2: explicit claim SUPPORTED only with scope-bound evidence from trusted independent verifier",()=>{
  const claim=candidate("Skrypt testowy zakończył się sukcesem.");
  const report=evaluateClaimEvidenceV2([claim],[finding(claim,"SUPPORTS")],[evidence],[verifier]);
  assert.equal(report.verdict,"SUPPORTED");
  assert.deepEqual(report.claims[0].evidence_ids,[evidence.evidence_id]);
  assert.equal(report.claims[0].reason,"VERIFIER_SUPPORT");
  assert.equal(report.coverage,"EXPLICIT_CLAIMS_ONLY");
});
test("v2: independent contradiction is CONTRADICTED, not a global chat veto",()=>{
  const claim=candidate("Zewnętrzny test przeszedł.");
  const report=evaluateClaimEvidenceV2([claim],[finding(claim,"CONTRADICTS")],[evidence],[verifier]);
  assert.equal(report.verdict,"CONTRADICTED");
  assert.equal(report.claims[0].reason,"VERIFIER_CONTRADICTION");
});
test("v2: conflicting verified findings yield UNKNOWN with both refs",()=>{
  const claim=candidate("Wynik jest jednoznaczny.");
  const report=evaluateClaimEvidenceV2([claim],[finding(claim,"SUPPORTS"),finding(claim,"CONTRADICTS")],[evidence],[verifier]);
  assert.equal(report.verdict,"UNKNOWN");
  assert.equal(report.claims[0].reason,"CONFLICTING_EVIDENCE");
});
test("v2: unrelated execution evidence and unauthorized verifier cannot certify a claim",()=>{
  const claim=candidate("Dane prywatne są dostępne.");
  const badClaim={...finding(claim,"SUPPORTS"),statement_sha256:"f".repeat(64)};
  const badRef={...finding(claim,"SUPPORTS"),evidence_id:"run_other:evidence:1"};
  const badHash={...finding(claim,"SUPPORTS"),evidence_sha256:"b".repeat(64)};
  const untrusted={...finding(claim,"SUPPORTS"),verifier_id:"model-nvidia-self-report"};
  for(const one of [badClaim,badRef,badHash,untrusted]){
    const report=evaluateClaimEvidenceV2([claim],[one],[evidence],[verifier]);
    assert.equal(report.verdict,"UNKNOWN");
    assert.equal(report.claims[0].reason,"NO_TRUSTED_EVIDENCE");
  }
});
test("v2: duplicate identifiers and unbounded candidates rejected",()=>{
  const claim=candidate("Powtórzone twierdzenie.");
  assert.throws(()=>evaluateClaimEvidenceV2([claim,claim],[],[],[]),/INVALID_CLAIM_CANDIDATE/);
  assert.throws(()=>evaluateClaimEvidenceV2(Array.from({length:101},(_,i)=>candidate("x",String(i))),[],[],[]),/CLAIM_EVALUATION_LIMIT/);
});
