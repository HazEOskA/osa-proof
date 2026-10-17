import assert from "node:assert/strict";
import test from "node:test";
import type { ProofAnchorV1, ProofReceipt } from "../packages/contracts/src";
import {
  createAgentIdentityV1,
  createAgentKeyPair,
  signerFromPrivateKey,
  canonicalizeAiId,
  parseAiId,
} from "../packages/identity/src";
import {
  AgentTrustSession,
  createDelegationV1,
  verifyActionReceiptV1,
  verifyDelegationV1,
  verifyRuntimeAttestationV1,
} from "../packages/runtime/src";
import {
  createMerkleProofV1,
  createProofBatchV1,
  sealProofReceipt,
  verifyMerkleProofV1,
} from "../packages/proof-core/src";
import { verifyProofAnchorBinding } from "../packages/web3/src";

const START = "2026-10-17T03:00:00.000Z";
const END = "2026-10-17T04:00:00.000Z";
const POLICY = "a".repeat(64);
const BUILD = "b".repeat(64);

function proofReceipt(): ProofReceipt {
  return sealProofReceipt({
    schema: "osa.proof_receipt.v2",
    run_id: "run_trust",
    execution_id: "exec_trust",
    organization_id: "org_trust",
    project_id: "project_trust",
    team_id: "team_trust",
    team_version: "1",
    mission_id: "mission_trust",
    binding: {
      organization_id: "org_trust",
      project_id: "project_trust",
      team_id: "team_trust",
      team_version: "1",
      mission_id: "mission_trust",
      run_id: "run_trust",
      execution_id: "exec_trust",
    },
    verdict: "VERIFIED",
    requirement_verdicts: [],
    evidence_ids: [],
    evidence_refs: [],
    evidence_root: "c".repeat(64),
    observation_refs: [],
    final_output_sha256: "d".repeat(64),
    created_at: START,
    verifier: { name: "osa-proof-deterministic", version: "2" },
  });
}

function fixture() {
  const controllerKeys = createAgentKeyPair();
  const agentKeys = createAgentKeyPair();
  const controllerSigner = signerFromPrivateKey(controllerKeys.private_key_pem, controllerKeys.key_id);
  const agentSigner = signerFromPrivateKey(agentKeys.private_key_pem, agentKeys.key_id);

  const identity = createAgentIdentityV1({
    ai_id: "@ai:osatechgpt.dev/agents/genesis",
    agent_id: "genesis",
    key_id: agentKeys.key_id,
    public_key_pem: agentKeys.public_key_pem,
    controller: "@ai:osatechgpt.dev",
    created_at: START,
  });

  const delegation = createDelegationV1(
    {
      principal: "@ai:osatechgpt.dev",
      agent_ai_id: identity.ai_id,
      scopes: ["repo:read", "artifact:create"],
      denied_scopes: ["production:deploy"],
      policy_digest: POLICY,
      valid_from: START,
      valid_until: END,
    },
    controllerSigner
  );

  const session = new AgentTrustSession({
    identity,
    delegation,
    controller_public_key_pem: controllerKeys.public_key_pem,
    signer: agentSigner,
    runtime_id: "runtime_genesis_001",
    execution_id: "exec_trust",
    build_digest: BUILD,
    policy_digest: POLICY,
    started_at: START,
    verify_at: new Date("2026-10-17T03:30:00.000Z"),
  });

  return { controllerKeys, agentKeys, identity, delegation, session };
}

test("@ai canonicalization is deterministic and rejects forbidden syntax", () => {
  assert.equal(canonicalizeAiId("@AI:OSAtechGPT.DEV/"), "@ai:osatechgpt.dev");
  assert.equal(
    canonicalizeAiId("@ai:Example.COM/research-agent"),
    "@ai:example.com/research-agent"
  );
  assert.deepEqual(parseAiId("@ai:example.com/a/b").profile_path, ["a", "b"]);
  assert.throws(() => canonicalizeAiId("@ai:user@example.com"));
  assert.throws(() => canonicalizeAiId("@ai:example.com:8080"));
  assert.throws(() => canonicalizeAiId("@ai:example.com/../admin"));
  assert.throws(() => canonicalizeAiId("@ai:example.com/agent?id=1"));
});

test("delegation and runtime attestation are cryptographically verifiable", () => {
  const { controllerKeys, identity, delegation, session } = fixture();
  assert.deepEqual(
    verifyDelegationV1(delegation, controllerKeys.public_key_pem, new Date("2026-10-17T03:30:00.000Z")),
    { ok: true, errors: [] }
  );
  assert.deepEqual(verifyRuntimeAttestationV1(session.runtime_attestation, identity), {
    ok: true,
    errors: [],
  });
  const expired = verifyDelegationV1(
    delegation,
    controllerKeys.public_key_pem,
    new Date("2026-10-17T05:00:00.000Z")
  );
  assert.equal(expired.ok, false);
  assert.ok(expired.errors.includes("delegation is not currently valid"));
});

test("action receipts form a signed causal chain and bind evidence", () => {
  const { identity, session } = fixture();
  const first = session.recordAction({
    run_id: "run_trust",
    operation_id: "exec_trust:op:1:genesis",
    input: { request: "inspect" },
    request: { tool: "repo.read" },
    result: { status: "ok" },
    evidence_refs: [{ evidence_id: "ev_1", evidence_sha256: "e".repeat(64) }],
    timestamp: "2026-10-17T03:31:00.000Z",
  });
  const second = session.recordAction({
    run_id: "run_trust",
    operation_id: "exec_trust:op:2:genesis",
    input: { from: "ev_1" },
    request: { tool: "artifact.create" },
    result: { artifact: "created" },
    timestamp: "2026-10-17T03:32:00.000Z",
  });

  assert.equal(second.parent_receipt_digest, first.receipt_digest);
  assert.deepEqual(verifyActionReceiptV1(first, identity), { ok: true, errors: [] });
  assert.deepEqual(verifyActionReceiptV1(second, identity), { ok: true, errors: [] });

  const tampered = structuredClone(second);
  tampered.result_digest = "f".repeat(64);
  const failed = verifyActionReceiptV1(tampered, identity);
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.includes("receipt_digest mismatch"));
  assert.ok(failed.errors.includes("action receipt signature invalid"));
});

test("ProofReceipt v2 and action receipts are committed into one Merkle batch", () => {
  const { session } = fixture();
  session.recordAction({
    run_id: "run_trust",
    operation_id: "exec_trust:op:1:genesis",
    input: { request: "inspect" },
    request: { tool: "repo.read" },
    result: { status: "ok" },
    timestamp: "2026-10-17T03:31:00.000Z",
  });
  session.recordAction({
    run_id: "run_trust",
    operation_id: "exec_trust:op:2:genesis",
    input: { request: "build" },
    request: { tool: "artifact.create" },
    result: { status: "ok" },
    timestamp: "2026-10-17T03:32:00.000Z",
  });

  const receipt = proofReceipt();
  const batch = createProofBatchV1(receipt, session.receipts(), "2026-10-17T03:33:00.000Z");
  assert.equal(batch.proof_receipt_sha256, receipt.receipt_sha256);
  assert.equal(batch.leaf_digests[0], receipt.receipt_sha256);
  assert.equal(batch.receipt_digests.length, 2);

  for (let index = 0; index < batch.leaf_digests.length; index += 1) {
    const proof = createMerkleProofV1(batch, index);
    assert.equal(verifyMerkleProofV1(proof), true);
    const tampered = { ...proof, leaf_digest: "0".repeat(64) };
    assert.equal(verifyMerkleProofV1(tampered), false);
  }
});

test("chain anchor verification binds a confirmed transaction to the batch root", () => {
  const batch = createProofBatchV1(proofReceipt(), [], "2026-10-17T03:33:00.000Z");
  const anchor: ProofAnchorV1 = {
    schema: "osa.proof_anchor.v1",
    merkle_root: batch.merkle_root,
    chain: "solana",
    network: "devnet",
    transaction_ref: "example-only-not-submitted",
    anchored_at: "2026-10-17T03:34:00.000Z",
    assurance: "CHAIN_CONFIRMED",
  };
  assert.equal(verifyProofAnchorBinding(anchor, batch), true);
  assert.equal(
    verifyProofAnchorBinding({ ...anchor, merkle_root: "1".repeat(64) }, batch),
    false
  );
});

test("AgentTrustSession finalization leaves ProofReceipt v2 unchanged and adds Trust artifacts beside it", () => {
  const { session } = fixture();
  const proof = proofReceipt();
  const before = structuredClone(proof);
  const artifacts = session.finalize(proof, "2026-10-17T03:33:00.000Z");
  assert.deepEqual(proof, before);
  assert.equal(artifacts.proof_batch.proof_receipt_sha256, proof.receipt_sha256);
  assert.equal(artifacts.runtime_attestation.execution_id, proof.execution_id);
});
