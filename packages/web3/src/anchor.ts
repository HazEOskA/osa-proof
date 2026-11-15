import type { ProofAnchorV1, ProofBatchV1 } from "../../contracts/src";
import { createMerkleProofV1, createProofBatchV1, verifyMerkleProofV1, verifyProofReceipt } from "../../proof-core/src";

export interface ProofAnchorAdapter {
  anchor(batch: ProofBatchV1): Promise<ProofAnchorV1>;
  verify(anchor: ProofAnchorV1, batch: ProofBatchV1): Promise<boolean>;
}

/** Prepare an integrity-checked commitment locally. This does not call a chain,
 * authenticate the source of a receipt, or assert the truth of its contents. */
export function prepareOfflineProofAnchor(
  input: Parameters<typeof verifyProofReceipt>[0],
  createdAt: string,
) {
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("ANCHOR_PREPARATION_TIME_INVALID");
  const integrity = verifyProofReceipt(input);
  if (!integrity.ok) throw new Error("ANCHOR_PROOF_INTEGRITY_INVALID");
  const batch = createProofBatchV1(input.receipt, [], createdAt);
  const inclusion = createMerkleProofV1(batch, 0);
  if (inclusion.leaf_digest !== input.receipt.receipt_sha256 || !verifyMerkleProofV1(inclusion)) {
    throw new Error("ANCHOR_PROOF_BINDING_INVALID");
  }
  return { status: "NOT_ANCHORED" as const, batch, inclusion };
}

export function verifyProofAnchorBinding(anchor: ProofAnchorV1, batch: ProofBatchV1): boolean {
  return (
    anchor.schema === "osa.proof_anchor.v1" &&
    anchor.assurance === "CHAIN_CONFIRMED" &&
    anchor.merkle_root === batch.merkle_root &&
    anchor.chain.trim().length > 0 &&
    anchor.network.trim().length > 0 &&
    anchor.transaction_ref.trim().length > 0 &&
    Number.isFinite(Date.parse(anchor.anchored_at))
  );
}
