import type {
  ActionReceiptV1,
  AgentIdentityV1,
  DelegationV1,
  ProofReceipt,
  RuntimeAttestationV1,
  TrustEvidenceRef,
  TrustRunArtifacts,
} from "../../contracts/src";
import type { CanonicalSigner } from "../../identity/src/agent-crypto";
import { verifyTrustPayload } from "../../identity/src/agent-crypto";
import { canonicalizeAiId } from "../../identity/src/ai-id";
import { createProofBatchV1 } from "../../proof-core/src/merkle";
import { digest } from "../../proof-core/src/canonical";

export function createDelegationV1(
  input: {
    principal: string;
    agent_ai_id: string;
    scopes: string[];
    denied_scopes?: string[];
    policy_digest: string;
    valid_from: string;
    valid_until: string;
    max_cost?: number;
  },
  signer: CanonicalSigner
): DelegationV1 {
  const base = {
    schema: "osa.delegation.v1" as const,
    principal: canonicalizeAiId(input.principal),
    agent_ai_id: canonicalizeAiId(input.agent_ai_id),
    scopes: [...new Set(input.scopes)].sort(),
    denied_scopes: [...new Set(input.denied_scopes ?? [])].sort(),
    policy_digest: input.policy_digest,
    valid_from: input.valid_from,
    valid_until: input.valid_until,
    ...(input.max_cost !== undefined ? { max_cost: input.max_cost } : {}),
  };
  const delegationDigest = digest(base);
  const signed = { ...base, delegation_digest: delegationDigest };
  return { ...signed, signature: signer.sign(signed) };
}

export function verifyDelegationV1(
  delegation: DelegationV1,
  controllerPublicKeyPem: string,
  at: Date = new Date()
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const { signature, delegation_digest: claimedDigest, ...base } = delegation;
  const actualDigest = digest(base);
  if (actualDigest !== claimedDigest) errors.push("delegation_digest mismatch");
  if (!verifyTrustPayload({ ...base, delegation_digest: claimedDigest }, signature, controllerPublicKeyPem)) {
    errors.push("delegation signature invalid");
  }
  const from = Date.parse(delegation.valid_from);
  const until = Date.parse(delegation.valid_until);
  const now = at.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) errors.push("delegation validity window invalid");
  else if (now < from || now > until) errors.push("delegation is not currently valid");
  return { ok: errors.length === 0, errors };
}

export function scopeAllowed(delegation: DelegationV1, scope: string): boolean {
  if (delegation.denied_scopes.includes(scope)) return false;
  return delegation.scopes.includes(scope) || delegation.scopes.includes("*");
}

export function createRuntimeAttestationV1(
  input: {
    agent_ai_id: string;
    runtime_id: string;
    execution_id: string;
    build_digest: string;
    policy_digest: string;
    delegation_digest: string;
    started_at: string;
  },
  signer: CanonicalSigner
): RuntimeAttestationV1 {
  const base = {
    schema: "osa.runtime_attestation.v1" as const,
    agent_ai_id: canonicalizeAiId(input.agent_ai_id),
    runtime_id: input.runtime_id,
    execution_id: input.execution_id,
    build_digest: input.build_digest,
    policy_digest: input.policy_digest,
    delegation_digest: input.delegation_digest,
    started_at: input.started_at,
  };
  const attestationDigest = digest(base);
  const signed = { ...base, attestation_digest: attestationDigest };
  return { ...signed, signature: signer.sign(signed) };
}

export function verifyRuntimeAttestationV1(
  attestation: RuntimeAttestationV1,
  identity: AgentIdentityV1
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const { signature, attestation_digest: claimedDigest, ...base } = attestation;
  if (identity.status !== "ACTIVE") errors.push("agent identity is revoked");
  if (attestation.agent_ai_id !== identity.ai_id) errors.push("agent identity mismatch");
  if (signature.key_id !== identity.key_id) errors.push("attestation key_id mismatch");
  if (digest(base) !== claimedDigest) errors.push("attestation_digest mismatch");
  if (!verifyTrustPayload({ ...base, attestation_digest: claimedDigest }, signature, identity.public_key_pem)) {
    errors.push("runtime attestation signature invalid");
  }
  return { ok: errors.length === 0, errors };
}

export function createActionReceiptV1(
  input: {
    agent_ai_id: string;
    runtime_id: string;
    run_id: string;
    execution_id: string;
    operation_id: string;
    parent_receipt_digest?: string;
    authority_digest: string;
    policy_digest: string;
    input: unknown;
    request: unknown;
    result: unknown;
    evidence_refs?: TrustEvidenceRef[];
    timestamp: string;
  },
  signer: CanonicalSigner
): ActionReceiptV1 {
  const base = {
    schema: "osa.action_receipt.v1" as const,
    agent_ai_id: canonicalizeAiId(input.agent_ai_id),
    runtime_id: input.runtime_id,
    run_id: input.run_id,
    execution_id: input.execution_id,
    operation_id: input.operation_id,
    ...(input.parent_receipt_digest ? { parent_receipt_digest: input.parent_receipt_digest } : {}),
    authority_digest: input.authority_digest,
    policy_digest: input.policy_digest,
    input_digest: digest(input.input),
    request_digest: digest(input.request),
    result_digest: digest(input.result),
    evidence_refs: [...(input.evidence_refs ?? [])],
    timestamp: input.timestamp,
  };
  const receiptDigest = digest(base);
  const signed = { ...base, receipt_digest: receiptDigest };
  return { ...signed, signature: signer.sign(signed) };
}

export function verifyActionReceiptV1(
  receipt: ActionReceiptV1,
  identity: AgentIdentityV1
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const { signature, receipt_digest: claimedDigest, ...base } = receipt;
  if (identity.status !== "ACTIVE") errors.push("agent identity is revoked");
  if (receipt.agent_ai_id !== identity.ai_id) errors.push("agent identity mismatch");
  if (signature.key_id !== identity.key_id) errors.push("receipt key_id mismatch");
  if (digest(base) !== claimedDigest) errors.push("receipt_digest mismatch");
  if (!verifyTrustPayload({ ...base, receipt_digest: claimedDigest }, signature, identity.public_key_pem)) {
    errors.push("action receipt signature invalid");
  }
  return { ok: errors.length === 0, errors };
}

export class AgentTrustSession {
  readonly runtime_attestation: RuntimeAttestationV1;
  private readonly actionReceipts: ActionReceiptV1[] = [];

  constructor(
    private readonly config: {
      identity: AgentIdentityV1;
      delegation: DelegationV1;
      controller_public_key_pem: string;
      signer: CanonicalSigner;
      runtime_id: string;
      execution_id: string;
      build_digest: string;
      policy_digest: string;
      started_at: string;
      verify_at?: Date;
    }
  ) {
    if (config.identity.ai_id !== config.delegation.agent_ai_id) {
      throw new Error("TRUST_AGENT_DELEGATION_MISMATCH");
    }
    if (config.identity.key_id !== config.signer.key_id) {
      throw new Error("TRUST_SIGNER_IDENTITY_KEY_MISMATCH");
    }
    if (config.delegation.policy_digest !== config.policy_digest) {
      throw new Error("TRUST_POLICY_DELEGATION_MISMATCH");
    }
    const verified = verifyDelegationV1(
      config.delegation,
      config.controller_public_key_pem,
      config.verify_at ?? new Date(config.started_at)
    );
    if (!verified.ok) throw new Error(`TRUST_DELEGATION_INVALID: ${verified.errors.join("; ")}`);

    this.runtime_attestation = createRuntimeAttestationV1(
      {
        agent_ai_id: config.identity.ai_id,
        runtime_id: config.runtime_id,
        execution_id: config.execution_id,
        build_digest: config.build_digest,
        policy_digest: config.policy_digest,
        delegation_digest: config.delegation.delegation_digest,
        started_at: config.started_at,
      },
      config.signer
    );
  }

  recordAction(input: {
    run_id: string;
    operation_id: string;
    input: unknown;
    request: unknown;
    result: unknown;
    evidence_refs?: TrustEvidenceRef[];
    timestamp: string;
  }): ActionReceiptV1 {
    const parent = this.actionReceipts.at(-1)?.receipt_digest;
    const receipt = createActionReceiptV1(
      {
        agent_ai_id: this.config.identity.ai_id,
        runtime_id: this.config.runtime_id,
        run_id: input.run_id,
        execution_id: this.config.execution_id,
        operation_id: input.operation_id,
        ...(parent ? { parent_receipt_digest: parent } : {}),
        authority_digest: this.config.delegation.delegation_digest,
        policy_digest: this.config.policy_digest,
        input: input.input,
        request: input.request,
        result: input.result,
        evidence_refs: input.evidence_refs,
        timestamp: input.timestamp,
      },
      this.config.signer
    );
    this.actionReceipts.push(receipt);
    return structuredClone(receipt);
  }

  receipts(): ActionReceiptV1[] {
    return this.actionReceipts.map((receipt) => structuredClone(receipt));
  }

  finalize(proof: ProofReceipt, createdAt: string): TrustRunArtifacts {
    return {
      runtime_attestation: structuredClone(this.runtime_attestation),
      action_receipts: this.receipts(),
      proof_batch: createProofBatchV1(proof, this.actionReceipts, createdAt),
    };
  }
}
