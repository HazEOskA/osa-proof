import type { AgentIdentityV1, DelegationV1, RunResult } from "../../../packages/contracts/src";
import type { DurableJob } from "../../../packages/durable-execution/src";
import { signerFromPrivateKey } from "../../../packages/identity/src/agent-crypto";
import { createMerkleProofV1, verifyProofReceipt } from "../../../packages/proof-core/src";
import {
  AgentTrustSession, scopeAllowed, verifyActionReceiptV1, verifyDelegationV1, verifyRuntimeAttestationV1,
} from "../../../packages/runtime/src/trust";

interface WorkerTrustConfiguration {
  scope: DurableJob["scope"];
  identity: AgentIdentityV1;
  delegation: DelegationV1;
  controller_public_key_pem: string;
  private_key_pem: string;
  build_digest: string;
  policy_digest: string;
}

/** The credential is local to the worker. The job never supplies a signer. */
export function startDurableChatTrust(job: DurableJob, serialized?: string) {
  if (!serialized) return undefined;
  const config = JSON.parse(serialized) as WorkerTrustConfiguration;
  const lease = job.lease;
  const identity = config.identity;
  const delegation = config.delegation;
  if (!config.scope || !identity || !delegation) throw Error("DURABLE_TRUST_CONFIGURATION_INVALID");
  if (config.scope.organization_id !== job.scope.organization_id ||
      config.scope.project_id !== job.scope.project_id ||
      config.scope.identity_id !== job.scope.identity_id || identity.agent_id !== job.input.agent) return undefined;
  if (!lease?.worker_id || job.input.kind !== "model" ||
      identity.schema !== "osa.agent_identity.v1" || identity.status !== "ACTIVE" ||
      delegation.schema !== "osa.delegation.v1" || delegation.principal !== identity.controller ||
      !scopeAllowed(delegation, "durable:chat") || delegation.max_cost !== 0 ||
      ![config.build_digest, config.policy_digest].every(value => /^[0-9a-f]{64}$/.test(value))) {
    throw Error("DURABLE_TRUST_SCOPE_INVALID");
  }
  const started = new Date();
  const session = new AgentTrustSession({
    identity, delegation, controller_public_key_pem: config.controller_public_key_pem,
    signer: signerFromPrivateKey(config.private_key_pem, identity.key_id),
    runtime_id: lease.worker_id, execution_id: job.input.execution_id,
    build_digest: config.build_digest, policy_digest: config.policy_digest,
    started_at: started.toISOString(), verify_at: started,
  });
  if (!verifyRuntimeAttestationV1(session.runtime_attestation, identity).ok) {
    throw Error("DURABLE_TRUST_SIGNER_INVALID");
  }
  return (run: RunResult) => {
    const at = new Date();
    const proof = run.proof;
    if (run.verdict !== "VERIFIED" || proof.verdict !== "VERIFIED" ||
        run.execution_id !== job.input.execution_id || proof.binding.execution_id !== run.execution_id ||
        proof.binding.organization_id !== job.scope.organization_id || proof.binding.project_id !== job.scope.project_id ||
        !verifyDelegationV1(delegation, config.controller_public_key_pem, at).ok ||
        !verifyProofReceipt({receipt: proof, evidence: run.evidence, observations: run.observations,
          final_output: run.final_output, tool_calls: run.tool_calls}).ok) {
      throw Error("DURABLE_TRUST_RUN_INVALID");
    }
    const action = session.recordAction({
      run_id: run.run_id, operation_id: "durable:chat",
      input: job.input,
      request: { scope: job.scope, generation: lease.generation, mission_id: proof.mission_id },
      result: { output: run.final_output, proof_receipt_sha256: proof.receipt_sha256 },
      evidence_refs: run.evidence.map(({evidence_id, evidence_sha256}) => ({evidence_id, evidence_sha256})),
      timestamp: at.toISOString(),
    });
    if (!verifyActionReceiptV1(action, identity).ok) throw Error("DURABLE_TRUST_RECEIPT_INVALID");
    const artifacts = session.finalize(proof, at.toISOString());
    return {
      identity, delegation, ...artifacts,
      inclusion: [createMerkleProofV1(artifacts.proof_batch, 0), createMerkleProofV1(artifacts.proof_batch, 1)],
      anchor_status: "NOT_ANCHORED" as const,
    };
  };
}
