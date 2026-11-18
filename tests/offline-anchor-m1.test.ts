import assert from "node:assert/strict";
import test from "node:test";
import { digest, sealProofReceipt, verifyMerkleProofV1 } from "../packages/proof-core/src";
import { prepareOfflineProofAnchor } from "../packages/web3/src/anchor";
import { buildGenesisAnchorMemo, GENESIS_AGENT_AI_ID } from "../packages/web3/src/solana/genesis-anchor";

test("offline anchor preparation binds the verified receipt without asserting chain confirmation", () => {
  const binding = { organization_id: "org_test", project_id: "project_test", team_id: "team_test", team_version: "1", mission_id: "mission_test", run_id: "run_test", execution_id: "exec_test" };
  const output = "controlled test output";
  const receipt = sealProofReceipt({
    schema: "osa.proof_receipt.v2", ...binding, binding, verdict: "VERIFIED", requirement_verdicts: [],
    evidence_ids: [], evidence_refs: [], evidence_root: digest([]), observation_refs: [],
    final_output_sha256: digest(output), created_at: "2026-11-13T00:00:00.000Z",
    verifier: { name: "osa-proof-deterministic", version: "2" },
  });
  const input = { receipt, evidence: [], observations: [], final_output: output };
  const prepared = prepareOfflineProofAnchor(input, "2026-11-13T00:00:01.000Z");
  assert.equal(prepared.status, "NOT_ANCHORED");
  assert.equal(prepared.batch.proof_receipt_sha256, receipt.receipt_sha256);
  assert.equal(prepared.inclusion.leaf_digest, receipt.receipt_sha256);
  assert.equal(prepared.inclusion.merkle_root, prepared.batch.merkle_root);
  assert.equal(verifyMerkleProofV1(prepared.inclusion), true);
  assert.throws(() => prepareOfflineProofAnchor({ ...input, final_output: "tampered" }, "2026-11-13T00:00:01.000Z"), /ANCHOR_PROOF_INTEGRITY_INVALID/);
  const memo = buildGenesisAnchorMemo({ agent_ai_id: GENESIS_AGENT_AI_ID, merkle_root: prepared.batch.merkle_root, proof_receipt_digest: receipt.receipt_sha256, artifact_digest: digest(output) });
  assert.ok(memo.includes(`merkle:${prepared.batch.merkle_root}`));
  assert.ok(memo.includes(`proof:${receipt.receipt_sha256}`));
});
