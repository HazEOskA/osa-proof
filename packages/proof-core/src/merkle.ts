import type {
  ActionReceiptV1,
  MerkleProofV1,
  MerkleProofStepV1,
  ProofBatchV1,
  ProofReceipt,
} from "../../contracts/src";
import { digest, sha256Hex } from "./canonical";

function assertDigest(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a lowercase sha256 hex digest`);
}

function leafHash(digestValue: string): string {
  assertDigest(digestValue, "leaf digest");
  return sha256Hex(`osa.merkle.leaf.v1:${digestValue}`);
}

function nodeHash(left: string, right: string): string {
  assertDigest(left, "left hash");
  assertDigest(right, "right hash");
  return sha256Hex(`osa.merkle.node.v1:${left}:${right}`);
}

export function merkleRootFromDigests(digests: string[]): string {
  if (digests.length === 0) throw new Error("at least one leaf digest is required");
  let level = digests.map(leafHash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(nodeHash(left, right));
    }
    level = next;
  }
  return level[0];
}

export function createProofBatchV1(
  proof: ProofReceipt,
  receipts: ActionReceiptV1[],
  createdAt: string
): ProofBatchV1 {
  assertDigest(proof.receipt_sha256, "proof receipt digest");
  const receiptDigests = receipts.map((receipt) => {
    assertDigest(receipt.receipt_digest, "action receipt digest");
    return receipt.receipt_digest;
  });
  const leafDigests = [proof.receipt_sha256, ...receiptDigests];
  const merkleRoot = merkleRootFromDigests(leafDigests);
  const batchBody = {
    schema: "osa.proof_batch.v1" as const,
    proof_receipt_sha256: proof.receipt_sha256,
    receipt_digests: receiptDigests,
    leaf_digests: leafDigests,
    merkle_root: merkleRoot,
    created_at: createdAt,
  };
  return {
    ...batchBody,
    batch_id: `batch_${digest(batchBody)}`,
  };
}

export function createMerkleProofV1(batch: ProofBatchV1, leafIndex: number): MerkleProofV1 {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= batch.leaf_digests.length) {
    throw new Error("leaf index out of range");
  }
  if (merkleRootFromDigests(batch.leaf_digests) !== batch.merkle_root) {
    throw new Error("batch merkle root does not match leaf digests");
  }

  let index = leafIndex;
  let level = batch.leaf_digests.map(leafHash);
  const steps: MerkleProofStepV1[] = [];

  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = level[siblingIndex] ?? level[index];
    steps.push({
      side: index % 2 === 0 ? "RIGHT" : "LEFT",
      hash: sibling,
    });

    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      next.push(nodeHash(left, right));
    }
    index = Math.floor(index / 2);
    level = next;
  }

  return {
    schema: "osa.merkle_proof.v1",
    leaf_index: leafIndex,
    leaf_digest: batch.leaf_digests[leafIndex],
    steps,
    merkle_root: batch.merkle_root,
  };
}

export function verifyMerkleProofV1(proof: MerkleProofV1): boolean {
  try {
    let current = leafHash(proof.leaf_digest);
    for (const step of proof.steps) {
      current = step.side === "LEFT" ? nodeHash(step.hash, current) : nodeHash(current, step.hash);
    }
    return current === proof.merkle_root;
  } catch {
    return false;
  }
}
