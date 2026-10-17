import type { ProofAnchorV1 } from "../../../contracts/src/trust";

export const GENESIS_ANCHOR_CONFIRM = "GENESIS_ANCHOR_000001";
export const MAX_DEVNET_AIRDROP_LAMPORTS = 10_000_000n;
export const GENESIS_AGENT_AI_ID = "@ai:osatechgpt.dev/agents/genesis";
export const GENESIS_SOLANA_RUNTIME = {
  kit: "8.5.0",
  rpc: "0.22.0",
  signer: "0.19.0",
  memo: "0.16.0",
} as const;

export interface GenesisAnchorInput {
  agent_ai_id: string;
  merkle_root: string;
  proof_receipt_digest: string;
  artifact_digest: string;
}

export interface GenesisAnchorExecution {
  anchor: ProofAnchorV1;
  payer_address: string;
  slot: number;
  memo: string;
  memo_program: string;
  airdrop_lamports: string;
}

function assertDigest(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be lowercase sha256 hex`);
}

export function validateGenesisAnchorInput(input: GenesisAnchorInput): void {
  if (input.agent_ai_id !== GENESIS_AGENT_AI_ID) throw new Error("GENESIS_ANCHOR_AGENT_ID_MISMATCH");
  assertDigest(input.merkle_root, "merkle_root");
  assertDigest(input.proof_receipt_digest, "proof_receipt_digest");
  assertDigest(input.artifact_digest, "artifact_digest");
}

export function buildGenesisAnchorMemo(input: GenesisAnchorInput): string {
  validateGenesisAnchorInput(input);
  return [
    "OSA|GENESIS|000001",
    `agent:${input.agent_ai_id}`,
    `merkle:${input.merkle_root}`,
    `proof:${input.proof_receipt_digest}`,
    `artifact:${input.artifact_digest}`,
  ].join("\n");
}

async function loadSolanaRuntime(): Promise<{
  kit: any;
  rpcPlugin: any;
  signerPlugin: any;
  memo: any;
}> {
  const dynamicImport = async (moduleName: string): Promise<any> => import(moduleName);
  const [kit, rpcPlugin, signerPlugin, memo] = await Promise.all([
    dynamicImport("@solana/kit"),
    dynamicImport("@solana/kit-plugin-rpc"),
    dynamicImport("@solana/kit-plugin-signer"),
    dynamicImport("@solana-program/memo"),
  ]);
  return { kit, rpcPlugin, signerPlugin, memo };
}

function extractMemoFromTransaction(raw: unknown, memoProgramAddress: string): string | null {
  const tx = raw as {
    transaction?: { message?: { instructions?: Array<Record<string, unknown>> } };
    meta?: { logMessages?: string[] | null };
  };
  const instructions = tx?.transaction?.message?.instructions;
  if (Array.isArray(instructions)) {
    for (const instruction of instructions) {
      if (String(instruction.programId ?? "") !== memoProgramAddress) continue;
      if (typeof instruction.parsed === "string") return instruction.parsed;
      if (instruction.parsed && typeof instruction.parsed === "object") {
        const parsed = instruction.parsed as Record<string, unknown>;
        if (typeof parsed.memo === "string") return parsed.memo;
        if (typeof parsed.info === "string") return parsed.info;
      }
    }
  }
  const logs = tx?.meta?.logMessages;
  if (Array.isArray(logs)) {
    for (const line of logs) {
      const match = /^Program log: Memo \(len \d+\): "(.*)"$/.exec(line);
      if (match) {
        try {
          return JSON.parse(`"${match[1]}"`);
        } catch {
          return match[1];
        }
      }
    }
  }
  return null;
}

export async function anchorGenesisProofOnSolanaDevnet(
  input: GenesisAnchorInput,
  options: { confirm: string; airdrop_lamports?: bigint },
): Promise<GenesisAnchorExecution> {
  validateGenesisAnchorInput(input);
  if (options.confirm !== GENESIS_ANCHOR_CONFIRM) throw new Error("GENESIS_ANCHOR_CONFIRMATION_REQUIRED");

  const airdropLamports = options.airdrop_lamports ?? MAX_DEVNET_AIRDROP_LAMPORTS;
  if (airdropLamports <= 0n || airdropLamports > MAX_DEVNET_AIRDROP_LAMPORTS) {
    throw new Error("GENESIS_ANCHOR_AIRDROP_LIMIT_EXCEEDED");
  }

  const { kit, rpcPlugin, signerPlugin, memo: memoRuntime } = await loadSolanaRuntime();
  const payer = await kit.generateKeyPairSigner();
  const client = kit
    .createClient()
    .use(signerPlugin.signer(payer))
    .use(rpcPlugin.solanaDevnetRpc())
    .use(memoRuntime.memoProgram());

  await client.airdrop(payer.address, kit.lamports(airdropLamports));

  const memo = buildGenesisAnchorMemo(input);
  const sent = await client.memo.instructions.addMemo({ memo }).sendTransaction();
  const transactionRef = String(sent.context.signature);

  let transaction: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    transaction = await client.rpc
      .getTransaction(transactionRef, {
        commitment: "finalized",
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
      })
      .send();
    if (transaction) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!transaction) throw new Error("GENESIS_ANCHOR_TRANSACTION_NOT_FINALIZED");

  const tx = transaction as { slot?: number | bigint; blockTime?: number | bigint | null };
  const slot = Number(tx.slot);
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error("GENESIS_ANCHOR_SLOT_INVALID");

  const memoProgramAddress = String(memoRuntime.MEMO_PROGRAM_ADDRESS);
  const observedMemo = extractMemoFromTransaction(transaction, memoProgramAddress);
  if (observedMemo !== memo) throw new Error("GENESIS_ANCHOR_MEMO_READBACK_MISMATCH");

  const blockTime = tx.blockTime == null ? null : Number(tx.blockTime);
  const anchoredAt =
    blockTime != null && Number.isFinite(blockTime)
      ? new Date(blockTime * 1000).toISOString()
      : new Date().toISOString();

  return {
    anchor: {
      schema: "osa.proof_anchor.v1",
      merkle_root: input.merkle_root,
      chain: "solana",
      network: "devnet",
      transaction_ref: transactionRef,
      anchored_at: anchoredAt,
      assurance: "CHAIN_CONFIRMED",
    },
    payer_address: String(payer.address),
    slot,
    memo,
    memo_program: memoProgramAddress,
    airdrop_lamports: airdropLamports.toString(),
  };
}
