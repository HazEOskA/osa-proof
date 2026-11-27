import { readFile } from "node:fs/promises";
import type { AgentIdentityV1, RunResult, TrustRunArtifacts } from "../../../packages/contracts/src";
import type { DurableJob, DurableRegistryAnchor, FileDurableJobStore } from "../../../packages/durable-execution/src";
import { createProofBatchV1, digest, verifyProofReceipt } from "../../../packages/proof-core/src";
import { verifyActionReceiptV1 } from "../../../packages/runtime/src/trust";
import { rebroadcastRegistryIntent, submitRegistryCommitment, verifyRegistryCommitment } from "../../../packages/web3/src/solana/proof-registry";

type SignedAudit = { run: RunResult; signed_trust?: TrustRunArtifacts };

export async function runDurableRegistryPass(store: FileDurableJobStore, env: NodeJS.ProcessEnv) {
  const programId = env.OSA_DURABLE_DEVNET_PROGRAM_ID?.trim();
  const authority = env.OSA_DURABLE_DEVNET_AUTHORITY?.trim();
  const keyFile = env.OSA_DURABLE_DEVNET_KEY_FILE?.trim();
  if (!programId || !authority || !keyFile || !env.OSA_DURABLE_CHAT_TRUST) return;
  const { scope, identity } = JSON.parse(env.OSA_DURABLE_CHAT_TRUST) as {
    scope: DurableJob["scope"]; identity: AgentIdentityV1;
  };
  const eligible = (await store.listRecords()).filter(job => {
    const result = job.result as { status?: string; audit?: SignedAudit } | undefined;
    return job.status === "COMPLETED" && result?.status === "PROVIDER_RESPONSE" && result.audit?.signed_trust &&
      job.scope.organization_id === scope.organization_id && job.scope.project_id === scope.project_id &&
      job.scope.identity_id === scope.identity_id && job.input.agent === identity.agent_id &&
      !["VERIFIED", "FAILED"].includes(job.registry_anchor?.status ?? "") &&
      (!job.registry_anchor || job.registry_anchor.programId === programId);
  });
  const job = eligible.sort((a, b) => a.updated_at.localeCompare(b.updated_at))[0];
  if (!job) return;
  const audit = (job.result as { audit: SignedAudit }).audit;
  const run = audit.run;
  const signed = audit.signed_trust!;
  const batch = signed.proof_batch;
  const proof = run.proof;
  const receipt = signed.action_receipts[0];
  const state: DurableRegistryAnchor = { status: "FAILED", network: "devnet", programId, merkleRoot: batch.merkle_root };
  if (run.verdict !== "VERIFIED" || proof.verdict !== "VERIFIED" || signed.action_receipts.length !== 1 ||
      proof.binding.organization_id !== scope.organization_id || proof.binding.project_id !== scope.project_id ||
      proof.binding.execution_id !== job.input.execution_id || receipt.execution_id !== job.input.execution_id ||
      receipt.run_id !== run.run_id || receipt.input_digest !== digest(job.input) ||
      receipt.result_digest !== digest({ output: run.final_output, proof_receipt_sha256: proof.receipt_sha256 }) ||
      !verifyActionReceiptV1(receipt, identity).ok ||
      !verifyProofReceipt({receipt: proof, evidence: run.evidence, observations: run.observations,
        final_output: run.final_output, tool_calls: run.tool_calls}).ok ||
      digest(createProofBatchV1(proof, signed.action_receipts, batch.created_at)) !== digest(batch)) {
    await store.updateRegistryAnchor(job, state);
    return;
  }
  const policy = { programId, authority };
  const prior = job.registry_anchor;
  if (prior) {
    if (!prior.transactionSignature || prior.programId !== programId || prior.merkleRoot !== state.merkleRoot) return;
    const readback = await verifyRegistryCommitment(policy, batch, prior.transactionSignature);
    if (readback.status === "UNKNOWN") await rebroadcastRegistryIntent({...prior, transactionSignature: prior.transactionSignature});
    await store.updateRegistryAnchor(job, readback.status === "VERIFIED"
      ? {...prior, status: "VERIFIED", account: readback.account, slot: readback.slot}
      : {...prior, status: readback.status});
    return;
  }
  let pending: DurableRegistryAnchor | undefined;
  try {
    const bytes: unknown = JSON.parse(await readFile(keyFile, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(x => !Number.isInteger(x) || x < 0 || x > 255))
      throw Error("DURABLE_REGISTRY_KEY_INVALID");
    await submitRegistryCommitment(policy, batch, Uint8Array.from(bytes), async intent => {
      const next: DurableRegistryAnchor = {...state, ...intent, status: "PENDING"};
      await store.updateRegistryAnchor(job, next);
      pending = next;
    });
  } catch {
    // A failed broadcast may have reached Devnet. Read the stored signature on
    // the next pass rather than signing a second transaction.
    if (!pending && !(await store.get(job.scope, job.input.execution_id))?.registry_anchor)
      await store.updateRegistryAnchor(job, state);
    return;
  }
  if (pending) await store.updateRegistryAnchor({...job, registry_anchor: pending}, {...pending, status: "SUBMITTED"});
}
