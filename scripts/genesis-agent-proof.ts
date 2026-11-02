import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EvidenceRecord, ProofReceipt, VerifierObservation } from "../packages/contracts/src";
import { EvidenceCollector, trustEvidenceRefs } from "../packages/evidence/src";
import { canonicalizeAiId } from "../packages/identity/src/ai-id";
import {
  createAgentIdentityV1,
  createAgentKeyPair,
  signerFromPrivateKey,
} from "../packages/identity/src/agent-crypto";
import {
  createMerkleProofV1,
  DeterministicProofVerifier,
  digest,
  sha256Hex,
  verifyMerkleProofV1,
  verifyProofReceipt,
} from "../packages/proof-core/src";
import {
  AgentTrustSession,
  createDelegationV1,
  scopeAllowed,
  verifyActionReceiptV1,
  verifyDelegationV1,
  verifyRuntimeAttestationV1,
} from "../packages/runtime/src/trust";

const GENESIS_AI_ID = "@ai:osatechgpt.dev/agents/genesis";
const CONTROLLER_AI_ID = "@ai:osatechgpt.dev";
const DEFAULT_BASE_SHA = "42306c18c819ebabe1c3aa27506b780d61aa0fd4";
const DENIED_SCOPES = [
  "repo:write",
  "git:commit",
  "git:push",
  "production:deploy",
  "network:write",
  "blockchain:write",
] as const;

export interface GenesisRunOptions {
  cwd?: string;
  approved_base_sha?: string;
  execution_branch_head?: string;
  now?: Date;
}

export interface GenesisArtifactV1 {
  schema: "osa.genesis_agent_proof.v1";
  proof_number: "000001";
  title: "GENESIS AGENT PROOF #000001";
  source: {
    repository: "HazEOskA/osa-proof";
    branch: "feature/agent-trust-fabric-v0.1";
    approved_base_sha: string;
    execution_branch_head: string;
    operation: "repo:read";
    target: "package.json";
    package_sha256: string;
    package_bytes: number;
    generator_sha256: string;
  };
  controller: {
    ai_id: string;
    key_id: string;
    public_key_pem: string;
  };
  agent_identity: ReturnType<typeof createAgentIdentityV1>;
  delegation: ReturnType<typeof createDelegationV1>;
  runtime_attestation: AgentTrustSession["runtime_attestation"];
  evidence: EvidenceRecord[];
  observations: VerifierObservation[];
  action_receipts: ReturnType<AgentTrustSession["receipts"]>;
  proof_receipt: ProofReceipt;
  proof_batch: ReturnType<AgentTrustSession["finalize"]>["proof_batch"];
  merkle_proofs: {
    proof_receipt: ReturnType<typeof createMerkleProofV1>;
    action_receipt: ReturnType<typeof createMerkleProofV1>;
  };
  verification: {
    identity_canonical: boolean;
    delegation_verified: boolean;
    repo_read_scope_allowed: boolean;
    denied_scopes_blocked: boolean;
    runtime_attestation_verified: boolean;
    action_receipt_verified: boolean;
    proof_receipt_verified: boolean;
    proof_merkle_verified: boolean;
    action_merkle_verified: boolean;
    tampered_action_rejected: boolean;
    tampered_evidence_rejected: boolean;
    no_private_keys_persisted: boolean;
  };
  generated_at: string;
  artifact_sha256: string;
}

function iso(date: Date): string {
  return date.toISOString();
}

function plusMs(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
}

function assertVerified(value: boolean, code: string): void {
  if (!value) throw new Error(code);
}

export async function runGenesisAgentProof(options: GenesisRunOptions = {}): Promise<GenesisArtifactV1> {
  const cwd = options.cwd ?? process.cwd();
  const approvedBaseSha = options.approved_base_sha ?? DEFAULT_BASE_SHA;
  const executionBranchHead = options.execution_branch_head ?? approvedBaseSha;
  const now = options.now ?? new Date();
  const generatedAt = iso(now);

  const packagePath = resolve(cwd, "package.json");
  const generatorPath = resolve(cwd, "scripts/genesis-agent-proof.ts");
  const [packageContent, generatorContent] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(generatorPath, "utf8"),
  ]);
  const packageSha256 = sha256Hex(Buffer.from(packageContent, "utf8"));
  const packageBytes = Buffer.byteLength(packageContent, "utf8");
  const generatorSha256 = sha256Hex(Buffer.from(generatorContent, "utf8"));

  const policy = {
    schema: "osa.genesis_policy.v1",
    allow: ["repo:read"],
    deny: [...DENIED_SCOPES],
    target: "package.json",
  };
  const policyDigest = digest(policy);

  const controllerKeys = createAgentKeyPair();
  const agentKeys = createAgentKeyPair();
  const controllerSigner = signerFromPrivateKey(controllerKeys.private_key_pem, controllerKeys.key_id);
  const agentSigner = signerFromPrivateKey(agentKeys.private_key_pem, agentKeys.key_id);

  const identity = createAgentIdentityV1({
    ai_id: GENESIS_AI_ID,
    agent_id: "genesis",
    key_id: agentKeys.key_id,
    public_key_pem: agentKeys.public_key_pem,
    controller: CONTROLLER_AI_ID,
    created_at: generatedAt,
  });

  const delegation = createDelegationV1(
    {
      principal: CONTROLLER_AI_ID,
      agent_ai_id: GENESIS_AI_ID,
      scopes: ["repo:read"],
      denied_scopes: [...DENIED_SCOPES],
      policy_digest: policyDigest,
      valid_from: plusMs(now, -60_000),
      valid_until: plusMs(now, 15 * 60_000),
    },
    controllerSigner
  );

  assertVerified(scopeAllowed(delegation, "repo:read"), "GENESIS_SCOPE_REPO_READ_NOT_ALLOWED");
  assertVerified(
    DENIED_SCOPES.every((scope) => !scopeAllowed(delegation, scope)),
    "GENESIS_DENIED_SCOPE_ALLOWED"
  );

  const runId = "run_genesis_000001";
  const executionId = `exec_genesis_${randomUUID()}`;
  const operationId = `${executionId}:op:1:genesis`;
  const runtimeId = `runtime_genesis_${randomUUID()}`;

  const binding = {
    organization_id: "org_osatechgpt",
    project_id: "project_osa_proof",
    team_id: "team_genesis",
    team_version: "1",
    mission_id: "mission_genesis_000001",
    run_id: runId,
    execution_id: executionId,
  };

  const collector = new EvidenceCollector();
  const evidence = collector.record({
    binding,
    producer: {
      type: "executor",
      agent_id: "genesis",
      executor_ref: "genesis.repo-read.v1",
      operation_id: operationId,
    },
    evidence: {
      kind: "repo_read",
      data: {
        status: "READ_OK",
        path: "package.json",
        content_sha256: packageSha256,
        approved_base_sha: approvedBaseSha,
        execution_branch_head: executionBranchHead,
      },
      content: packageContent,
    },
  });

  assertVerified(evidence.content_sha256 === packageSha256, "GENESIS_EVIDENCE_CONTENT_DIGEST_MISMATCH");
  assertVerified(evidence.content_bytes === packageBytes, "GENESIS_EVIDENCE_CONTENT_SIZE_MISMATCH");

  const graph = {
    organization_id: binding.organization_id,
    project_id: binding.project_id,
    team_id: binding.team_id,
    version: binding.team_version,
    agents: [{ agent_id: "genesis", role: "genesis", executor_ref: "genesis.repo-read.v1" }],
    edges: [],
  };
  const mission = {
    organization_id: binding.organization_id,
    project_id: binding.project_id,
    mission_id: binding.mission_id,
    team_id: binding.team_id,
    team_version: binding.team_version,
    objective: "Read package.json and produce independently verifiable evidence",
    entry_agent_id: "genesis",
    input: { operation: "repo:read", path: "package.json" },
    requirements: [
      {
        requirement_id: "genesis_repo_read",
        type: "evidence_field_equals" as const,
        evidence_kind: "repo_read",
        field: "status",
        expected: "READ_OK",
        agent_id: "genesis",
      },
    ],
  };
  const finalOutput = {
    status: "READ_OK",
    path: "package.json",
    content_sha256: packageSha256,
    content_bytes: packageBytes,
  };

  const proofResult = new DeterministicProofVerifier().verify({
    run_id: runId,
    execution_id: executionId,
    graph,
    mission,
    evidence: [evidence],
    final_output: finalOutput,
    created_at: generatedAt,
  });
  assertVerified(proofResult.proof.verdict === "VERIFIED", "GENESIS_PROOF_NOT_VERIFIED");

  const session = new AgentTrustSession({
    identity,
    delegation,
    controller_public_key_pem: controllerKeys.public_key_pem,
    signer: agentSigner,
    runtime_id: runtimeId,
    execution_id: executionId,
    build_digest: generatorSha256,
    policy_digest: policyDigest,
    started_at: generatedAt,
    verify_at: now,
  });

  const actionReceipt = session.recordAction({
    run_id: runId,
    operation_id: operationId,
    input: { operation: "repo:read", path: "package.json" },
    request: { filesystem: "repo", mode: "utf8", path: "package.json" },
    result: finalOutput,
    evidence_refs: trustEvidenceRefs([evidence]),
    timestamp: generatedAt,
  });

  const trustArtifacts = session.finalize(proofResult.proof, generatedAt);
  const proofMerkle = createMerkleProofV1(trustArtifacts.proof_batch, 0);
  const actionMerkle = createMerkleProofV1(trustArtifacts.proof_batch, 1);

  const delegationVerification = verifyDelegationV1(delegation, controllerKeys.public_key_pem, now);
  const runtimeVerification = verifyRuntimeAttestationV1(session.runtime_attestation, identity);
  const actionVerification = verifyActionReceiptV1(actionReceipt, identity);
  const proofVerification = verifyProofReceipt({
    receipt: proofResult.proof,
    evidence: [evidence],
    observations: proofResult.observations,
    final_output: finalOutput,
  });

  const tamperedAction = structuredClone(actionReceipt);
  tamperedAction.result_digest = "0".repeat(64);
  const tamperedActionRejected = !verifyActionReceiptV1(tamperedAction, identity).ok;

  const tamperedEvidence = structuredClone(evidence);
  tamperedEvidence.data.status = "TAMPERED";
  const tamperedEvidenceRejected = !verifyProofReceipt({
    receipt: proofResult.proof,
    evidence: [tamperedEvidence],
    observations: proofResult.observations,
    final_output: finalOutput,
  }).ok;

  const publicBody = {
    schema: "osa.genesis_agent_proof.v1" as const,
    proof_number: "000001" as const,
    title: "GENESIS AGENT PROOF #000001" as const,
    source: {
      repository: "HazEOskA/osa-proof" as const,
      branch: "feature/agent-trust-fabric-v0.1" as const,
      approved_base_sha: approvedBaseSha,
      execution_branch_head: executionBranchHead,
      operation: "repo:read" as const,
      target: "package.json" as const,
      package_sha256: packageSha256,
      package_bytes: packageBytes,
      generator_sha256: generatorSha256,
    },
    controller: {
      ai_id: canonicalizeAiId(CONTROLLER_AI_ID),
      key_id: controllerKeys.key_id,
      public_key_pem: controllerKeys.public_key_pem,
    },
    agent_identity: identity,
    delegation,
    runtime_attestation: session.runtime_attestation,
    evidence: [evidence],
    observations: proofResult.observations,
    action_receipts: trustArtifacts.action_receipts,
    proof_receipt: proofResult.proof,
    proof_batch: trustArtifacts.proof_batch,
    merkle_proofs: {
      proof_receipt: proofMerkle,
      action_receipt: actionMerkle,
    },
    verification: {
      identity_canonical: identity.ai_id === GENESIS_AI_ID && identity.controller === CONTROLLER_AI_ID,
      delegation_verified: delegationVerification.ok,
      repo_read_scope_allowed: scopeAllowed(delegation, "repo:read"),
      denied_scopes_blocked: DENIED_SCOPES.every((scope) => !scopeAllowed(delegation, scope)),
      runtime_attestation_verified: runtimeVerification.ok,
      action_receipt_verified: actionVerification.ok,
      proof_receipt_verified: proofVerification.ok,
      proof_merkle_verified: verifyMerkleProofV1(proofMerkle),
      action_merkle_verified: verifyMerkleProofV1(actionMerkle),
      tampered_action_rejected: tamperedActionRejected,
      tampered_evidence_rejected: tamperedEvidenceRejected,
      no_private_keys_persisted: true,
    },
    generated_at: generatedAt,
  };

  const serializedPublicBody = JSON.stringify(publicBody);
  const noPrivateKeysPersisted =
    !serializedPublicBody.includes(controllerKeys.private_key_pem) &&
    !serializedPublicBody.includes(agentKeys.private_key_pem) &&
    !serializedPublicBody.includes("BEGIN PRIVATE KEY");
  assertVerified(noPrivateKeysPersisted, "GENESIS_PRIVATE_KEY_LEAK");

  const verifiedFlags = Object.entries(publicBody.verification)
    .filter(([key]) => key !== "no_private_keys_persisted")
    .every(([, value]) => value === true);
  assertVerified(verifiedFlags, "GENESIS_INDEPENDENT_VERIFICATION_FAILED");

  const body = {
    ...publicBody,
    verification: {
      ...publicBody.verification,
      no_private_keys_persisted: noPrivateKeysPersisted,
    },
  };
  const artifact: GenesisArtifactV1 = {
    ...body,
    artifact_sha256: digest(body),
  };
  return artifact;
}

export function genesisMarkdown(artifact: GenesisArtifactV1): string {
  const v = artifact.verification;
  return `# GENESIS AGENT PROOF #000001

**Agent:** ${artifact.agent_identity.ai_id}  
**Controller:** ${artifact.controller.ai_id}  
**Operation:** ${artifact.source.operation} \`${artifact.source.target}\`  
**Approved base:** \`${artifact.source.approved_base_sha}\`  
**Execution branch head:** \`${artifact.source.execution_branch_head}\`  
**Generated:** ${artifact.generated_at}

## Proof chain

\`\`\`text
@ai identity
  -> signed delegation
  -> runtime attestation
  -> real repo:read(package.json)
  -> EvidenceRecord
  -> ActionReceiptV1
  -> ProofReceipt V2
  -> ProofBatchV1
  -> Merkle inclusion proof
  -> independent verification
\`\`\`

## Primary digests

- package.json SHA-256: \`${artifact.source.package_sha256}\`
- EvidenceRecord: \`${artifact.evidence[0].evidence_sha256}\`
- ActionReceiptV1: \`${artifact.action_receipts[0].receipt_digest}\`
- ProofReceipt V2: \`${artifact.proof_receipt.receipt_sha256}\`
- Merkle root: \`${artifact.proof_batch.merkle_root}\`
- Artifact: \`${artifact.artifact_sha256}\`

## Verification

- Identity canonical: **${v.identity_canonical ? "PASS" : "FAIL"}**
- Delegation: **${v.delegation_verified ? "PASS" : "FAIL"}**
- repo:read allowed: **${v.repo_read_scope_allowed ? "PASS" : "FAIL"}**
- denied scopes blocked: **${v.denied_scopes_blocked ? "PASS" : "FAIL"}**
- Runtime attestation: **${v.runtime_attestation_verified ? "PASS" : "FAIL"}**
- Action receipt: **${v.action_receipt_verified ? "PASS" : "FAIL"}**
- ProofReceipt V2: **${v.proof_receipt_verified ? "PASS" : "FAIL"}**
- Proof Merkle inclusion: **${v.proof_merkle_verified ? "PASS" : "FAIL"}**
- Action Merkle inclusion: **${v.action_merkle_verified ? "PASS" : "FAIL"}**
- Tampered action rejected: **${v.tampered_action_rejected ? "PASS" : "FAIL"}**
- Tampered evidence rejected: **${v.tampered_evidence_rejected ? "PASS" : "FAIL"}**
- Private keys excluded: **${v.no_private_keys_persisted ? "PASS" : "FAIL"}**

## Boundary

This proof contains public keys, signatures, digests, evidence metadata, ProofReceipt V2 and Merkle proofs. It contains **no private key**, performs **no network write**, **no deployment**, **no DNS change**, and **no blockchain transaction**.
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string, fallback?: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const outJson = value("--out-json", "docs/evidence/genesis-agent-proof-000001.json")!;
  const outMd = value("--out-md", "docs/GENESIS_AGENT_PROOF_000001.md")!;
  const approvedBaseSha = value("--base-sha", DEFAULT_BASE_SHA)!;
  const executionBranchHead = value("--branch-head", approvedBaseSha)!;

  const artifact = await runGenesisAgentProof({
    approved_base_sha: approvedBaseSha,
    execution_branch_head: executionBranchHead,
  });

  await mkdir(dirname(resolve(process.cwd(), outJson)), { recursive: true });
  await mkdir(dirname(resolve(process.cwd(), outMd)), { recursive: true });
  await writeFile(resolve(process.cwd(), outJson), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  await writeFile(resolve(process.cwd(), outMd), genesisMarkdown(artifact), "utf8");
  process.stdout.write(
    JSON.stringify({
      status: "GENESIS_AGENT_PROOF_VERIFIED",
      proof_number: artifact.proof_number,
      agent: artifact.agent_identity.ai_id,
      proof_id: artifact.proof_receipt.proof_id,
      artifact_sha256: artifact.artifact_sha256,
      merkle_root: artifact.proof_batch.merkle_root,
    }) + "\n"
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
