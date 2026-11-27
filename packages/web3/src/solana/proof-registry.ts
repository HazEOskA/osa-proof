import type { ProofBatchV1 } from "../../../contracts/src";
import { digest, merkleRootFromDigests } from "../../../proof-core/src";

const DEVNET = "https://api.devnet.solana.com";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string, length: number): Buffer {
  if (value.length === 0 || value.length > Math.ceil(length * 1.38)) throw Error("INVALID_BASE58");
  let number = 0n;
  for (const ch of value) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) throw Error("INVALID_BASE58");
    number = number * 58n + BigInt(digit);
  }
  const hex = number.toString(16);
  const bytes = number === 0n ? Buffer.alloc(0) : Buffer.from(hex.padStart(hex.length + hex.length % 2, "0"), "hex");
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  if (zeros + bytes.length !== length) throw Error("INVALID_BASE58_LENGTH");
  return Buffer.concat([Buffer.alloc(zeros), bytes]);
}

export function registryCommitInstruction(batch: ProofBatchV1): Buffer {
  const { batch_id, ...body } = batch;
  const leaves = [batch.proof_receipt_sha256, ...batch.receipt_digests];
  const batchDigest = digest(body);
  if (body.schema !== "osa.proof_batch.v1" || !Number.isFinite(Date.parse(body.created_at)) ||
      batch_id !== `batch_${batchDigest}` || digest(leaves) !== digest(batch.leaf_digests) ||
      leaves.length < 2 || merkleRootFromDigests(leaves) !== batch.merkle_root) {
    throw Error("INVALID_REGISTRY_BATCH");
  }
  return Buffer.concat([Buffer.from([1]), Buffer.from(batchDigest, "hex"), Buffer.from(batch.merkle_root, "hex")]);
}

type RegistryPolicy = { programId: string; authority: string };

/** Each caller must persist the signature before broadcasting. Recovery reads
 * that signature first and never resubmits an ambiguous transaction. */
export async function submitRegistryCommitment(
  policy: RegistryPolicy,
  batch: ProofBatchV1,
  authorityKeyBytes: Uint8Array,
  recordIntent: (intent: { transactionSignature: string; account: string; lastValidBlockHeight: string }) => Promise<void>,
): Promise<string> {
  const data = registryCommitInstruction(batch);
  // Same optional Solana Kit runtime as the Genesis adapter.
  const kit = await (new Function("moduleName", "return import(moduleName)") as
    (name: string) => Promise<any>)("@solana/kit");
  const programAddress = kit.address(policy.programId);
  const authority = await kit.createKeyPairSignerFromBytes(authorityKeyBytes);
  if (authority.address !== policy.authority) throw Error("REGISTRY_AUTHORITY_MISMATCH");
  const rpc = kit.createSolanaRpc(kit.devnet(DEVNET));
  if (await rpc.getGenesisHash().send() !== DEVNET_GENESIS) throw Error("REGISTRY_CLUSTER_MISMATCH");
  const encoder = new TextEncoder();
  const [config] = await kit.getProgramDerivedAddress({ programAddress, seeds: [encoder.encode("registry-v1")] });
  const [account] = await kit.getProgramDerivedAddress({ programAddress, seeds: [encoder.encode("proof-v1"), data.subarray(1, 33)] });
  const instruction = {
    programAddress, data: new Uint8Array(data),
    accounts: [
      { address: authority.address, role: kit.AccountRole.WRITABLE_SIGNER, signer: authority },
      { address: config, role: kit.AccountRole.READONLY },
      { address: account, role: kit.AccountRole.WRITABLE },
      { address: kit.address("11111111111111111111111111111111"), role: kit.AccountRole.READONLY },
    ],
  };
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  const message = kit.pipe(
    kit.createTransactionMessage({ version: "legacy" }),
    (tx: any) => kit.setTransactionMessageFeePayerSigner(authority, tx),
    (tx: any) => kit.setTransactionMessageLifetimeUsingBlockhash(latest, tx),
    (tx: any) => kit.appendTransactionMessageInstructions([instruction], tx),
  );
  const signed = await kit.signTransactionMessageWithSigners(message);
  const transactionSignature = String(kit.getSignatureFromTransaction(signed));
  await recordIntent({ transactionSignature, account, lastValidBlockHeight: String(latest.lastValidBlockHeight) });
  await kit.sendTransactionWithoutConfirmingFactory({ rpc })(signed, { commitment: "confirmed" });
  return transactionSignature;
}

type Transaction = {
  slot: number;
  meta: { err: unknown } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean }>;
      instructions: Array<{ programId: string; accounts?: string[]; data?: string }>;
    };
  };
};
type AccountInfo = {
  context: { slot: number };
  value: { owner: string; executable: boolean; data: [string, string] } | null;
};

export async function verifyRegistryCommitment(
  policy: RegistryPolicy,
  batch: ProofBatchV1,
  transactionSignature: string,
  fetchFn: typeof fetch = fetch,
): Promise<
  | { status: "VERIFIED"; network: "devnet"; programId: string; authority: string; account: string; transactionSignature: string; slot: number; merkleRoot: string }
  | { status: "UNKNOWN" | "FAILED" }
> {
  let instruction: Buffer;
  let authorityBytes: Buffer;
  try {
    decodeBase58(policy.programId, 32);
    authorityBytes = decodeBase58(policy.authority, 32);
    decodeBase58(transactionSignature, 64);
    instruction = registryCommitInstruction(batch);
  } catch {
    return { status: "FAILED" };
  }
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetchFn(DEVNET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw Error("REGISTRY_RPC_UNAVAILABLE");
    const body = await response.json() as { result?: T; error?: unknown };
    if (body.error || body.result === undefined) throw Error("REGISTRY_RPC_ERROR");
    return body.result;
  }
  try {
    if (await rpc<string>("getGenesisHash", []) !== DEVNET_GENESIS) return { status: "FAILED" };
    const tx = await rpc<Transaction | null>("getTransaction", [transactionSignature, {
      commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0,
    }]);
    if (!tx) return { status: "UNKNOWN" };
    const { message, signatures } = tx.transaction;
    if (tx.meta?.err !== null || !Number.isSafeInteger(tx.slot) || tx.slot <= 0 ||
        signatures[0] !== transactionSignature ||
        !message.accountKeys.some(key => key.pubkey === policy.authority && key.signer === true)) {
      return { status: "FAILED" };
    }
    const commits = message.instructions.filter(ix => {
      if (ix.programId !== policy.programId || ix.accounts?.length !== 4 ||
          ix.accounts[0] !== policy.authority || ix.accounts[3] !== "11111111111111111111111111111111" || !ix.data) return false;
      try { return instruction.equals(decodeBase58(ix.data, 65)); } catch { return false; }
    });
    if (commits.length !== 1) return { status: "FAILED" };
    const account = commits[0].accounts![2];
    decodeBase58(account, 32);
    const readback = await rpc<AccountInfo>("getAccountInfo", [account, {
      commitment: "finalized", encoding: "base64", minContextSlot: tx.slot,
    }]);
    if (!readback.value || !Number.isSafeInteger(readback.context.slot) || readback.context.slot < tx.slot) return { status: "UNKNOWN" };
    const expected = Buffer.concat([Buffer.from([1]), authorityBytes, instruction.subarray(1)]);
    if (readback.value.owner !== policy.programId || readback.value.executable !== false ||
        readback.value.data[1] !== "base64" || readback.value.data[0] !== expected.toString("base64")) return { status: "FAILED" };
    return { status: "VERIFIED", network: "devnet", ...policy, account, transactionSignature, slot: tx.slot, merkleRoot: batch.merkle_root };
  } catch {
    return { status: "UNKNOWN" };
  }
}
