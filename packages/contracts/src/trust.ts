export type AgentTrustStatus = "ACTIVE" | "REVOKED";

export interface TrustSignature {
  alg: "Ed25519";
  key_id: string;
  value: string;
}

export interface TrustEvidenceRef {
  evidence_id: string;
  evidence_sha256: string;
}

export interface AgentIdentityV1 {
  schema: "osa.agent_identity.v1";
  ai_id: string;
  agent_id: string;
  key_id: string;
  public_key_pem: string;
  controller: string;
  status: AgentTrustStatus;
  created_at: string;
}

export interface DelegationV1 {
  schema: "osa.delegation.v1";
  principal: string;
  agent_ai_id: string;
  scopes: string[];
  denied_scopes: string[];
  policy_digest: string;
  valid_from: string;
  valid_until: string;
  max_cost?: number;
  delegation_digest: string;
  signature: TrustSignature;
}

export interface RuntimeAttestationV1 {
  schema: "osa.runtime_attestation.v1";
  agent_ai_id: string;
  runtime_id: string;
  execution_id: string;
  build_digest: string;
  policy_digest: string;
  delegation_digest: string;
  started_at: string;
  attestation_digest: string;
  signature: TrustSignature;
}

export interface ActionReceiptV1 {
  schema: "osa.action_receipt.v1";
  agent_ai_id: string;
  runtime_id: string;
  run_id: string;
  execution_id: string;
  operation_id: string;
  parent_receipt_digest?: string;
  authority_digest: string;
  policy_digest: string;
  input_digest: string;
  request_digest: string;
  result_digest: string;
  evidence_refs: TrustEvidenceRef[];
  timestamp: string;
  receipt_digest: string;
  signature: TrustSignature;
}

export interface MerkleProofStepV1 {
  side: "LEFT" | "RIGHT";
  hash: string;
}

export interface MerkleProofV1 {
  schema: "osa.merkle_proof.v1";
  leaf_index: number;
  leaf_digest: string;
  steps: MerkleProofStepV1[];
  merkle_root: string;
}

export interface ProofBatchV1 {
  schema: "osa.proof_batch.v1";
  batch_id: string;
  proof_receipt_sha256: string;
  receipt_digests: string[];
  leaf_digests: string[];
  merkle_root: string;
  created_at: string;
}

export interface ProofAnchorV1 {
  schema: "osa.proof_anchor.v1";
  merkle_root: string;
  chain: string;
  network: string;
  transaction_ref: string;
  anchored_at: string;
  assurance: "CHAIN_CONFIRMED";
}

export interface TrustRunArtifacts {
  runtime_attestation: RuntimeAttestationV1;
  action_receipts: ActionReceiptV1[];
  proof_batch: ProofBatchV1;
}
