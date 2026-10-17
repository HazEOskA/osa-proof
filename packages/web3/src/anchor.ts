import type { ProofAnchorV1, ProofBatchV1 } from "../../contracts/src";

export interface ProofAnchorAdapter {
  anchor(batch: ProofBatchV1): Promise<ProofAnchorV1>;
  verify(anchor: ProofAnchorV1, batch: ProofBatchV1): Promise<boolean>;
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
