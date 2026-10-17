import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { digest, sha256Hex } from "../packages/proof-core/src/canonical";
import { anchorGenesisProofOnSolanaDevnet, GENESIS_ANCHOR_CONFIRM, type GenesisAnchorInput } from "../packages/web3/src/solana/genesis-anchor";

interface GenesisProofArtifact {
  schema: string;
  agent_identity: { ai_id: string };
  proof_receipt: { receipt_sha256: string };
  proof_batch: { merkle_root: string; leaf_digests: string[] };
  verification: Record<string, boolean>;
  artifact_sha256: string;
  [key: string]: unknown;
}
function merkleRootFromDigests(digests: string[]): string {
  if (digests.length === 0) throw new Error("GENESIS_SOURCE_MERKLE_EMPTY");
  const leafHash = (value: string) => sha256Hex(`osa.merkle.leaf.v1:${value}`);
  const nodeHash = (left: string, right: string) => sha256Hex(`osa.merkle.node.v1:${left}:${right}`);
  let level = digests.map(leafHash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(nodeHash(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0];
}
function verifyGenesisArtifact(artifact: GenesisProofArtifact): GenesisAnchorInput {
  if (artifact.schema !== "osa.genesis_agent_proof.v1") throw new Error("GENESIS_SOURCE_SCHEMA_INVALID");
  const { artifact_sha256: claimedArtifactDigest, ...body } = artifact;
  if (digest(body) !== claimedArtifactDigest) throw new Error("GENESIS_SOURCE_ARTIFACT_DIGEST_INVALID");
  if (!Object.values(artifact.verification).every((value) => value === true)) throw new Error("GENESIS_SOURCE_VERIFICATION_FLAGS_INVALID");
  if (merkleRootFromDigests(artifact.proof_batch.leaf_digests) !== artifact.proof_batch.merkle_root) throw new Error("GENESIS_SOURCE_MERKLE_ROOT_INVALID");
  return {
    agent_ai_id: artifact.agent_identity.ai_id,
    merkle_root: artifact.proof_batch.merkle_root,
    proof_receipt_digest: artifact.proof_receipt.receipt_sha256,
    artifact_digest: claimedArtifactDigest,
  };
}
export async function runGenesisAnchor(inputPath: string, outputPath: string) {
  const source = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8")) as GenesisProofArtifact;
  const anchorInput = verifyGenesisArtifact(source);
  const requestedAirdrop = BigInt(process.env.OSA_GENESIS_AIRDROP_LAMPORTS ?? "10000000");
  const execution = await anchorGenesisProofOnSolanaDevnet(anchorInput, {
    confirm: process.env.OSA_GENESIS_ANCHOR_CONFIRM ?? "",
    airdrop_lamports: requestedAirdrop,
    on_event: (event) => process.stderr.write(JSON.stringify(event) + "\n"),
  });
  const body = {
    schema: "osa.genesis_anchor.v1" as const,
    anchor_number: "000001" as const,
    source: {
      genesis_artifact_sha256: anchorInput.artifact_digest,
      merkle_root: anchorInput.merkle_root,
      proof_receipt_digest: anchorInput.proof_receipt_digest,
      agent_ai_id: anchorInput.agent_ai_id,
    },
    network: {
      chain: "solana" as const,
      cluster: "devnet" as const,
      memo_program: execution.memo_program,
      payer_address: execution.payer_address,
      airdrop_lamports: execution.airdrop_lamports,
      airdrop_transaction_ref: execution.airdrop_transaction_ref,
      slot: execution.slot,
    },
    memo: execution.memo,
    proof_anchor: execution.anchor,
    verification: {
      source_artifact_digest_verified: true,
      source_verification_flags_true: true,
      merkle_root_recomputed: true,
      anchor_binding_verified: execution.anchor.merkle_root === anchorInput.merkle_root,
      devnet_only: execution.anchor.chain === "solana" && execution.anchor.network === "devnet",
      transaction_finalized: execution.anchor.assurance === "CHAIN_CONFIRMED",
      memo_readback_verified: true,
      private_key_persisted: false as const,
    },
    created_at: new Date().toISOString(),
  };
  const positive = Object.entries(body.verification).filter(([key]) => key !== "private_key_persisted").every(([, value]) => value === true);
  if (!positive || body.verification.private_key_persisted !== false) throw new Error("GENESIS_ANCHOR_VERIFICATION_FAILED");
  const artifact = { ...body, artifact_sha256: digest(body) };
  await mkdir(dirname(resolve(process.cwd(), outputPath)), { recursive: true });
  await writeFile(resolve(process.cwd(), outputPath), JSON.stringify(artifact, null, 2) + "\n", "utf8");
  return artifact;
}
async function main(): Promise<void> {
  if ((process.env.OSA_GENESIS_ANCHOR_CONFIRM ?? "") !== GENESIS_ANCHOR_CONFIRM) throw new Error("GENESIS_ANCHOR_CONFIRMATION_REQUIRED");
  const artifact = await runGenesisAnchor(
    process.argv[2] ?? "docs/evidence/genesis-agent-proof-000001.json",
    process.argv[3] ?? "docs/evidence/genesis-anchor-000001.json",
  );
  process.stdout.write(JSON.stringify({
    status: "GENESIS_ANCHOR_CONFIRMED",
    transaction_ref: artifact.proof_anchor.transaction_ref,
    slot: artifact.network.slot,
    payer_address: artifact.network.payer_address,
    airdrop_lamports: artifact.network.airdrop_lamports,
    merkle_root: artifact.source.merkle_root,
    artifact_sha256: artifact.artifact_sha256,
  }) + "\n");
}
if (require.main === module) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
