import { ChainAdapter, ChainObservation, WatchOptions, Web3Chain, Web3TransactionIntent } from "../../../contracts/src";
import { object, safeMetadata, text, Web3Error } from "../context";
import { assertWriteUnavailable } from "../policy";
import { assertBase58, integer, unsignedAmount, SolanaRPC } from "./rpc";
export const SPL_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
export class SolanaAdapter implements ChainAdapter {
  private network?: Web3Chain;
  constructor(private readonly rpc: SolanaRPC, private readonly clock = () => new Date()) {}
  async connect(): Promise<Web3Chain> {
    const genesis = await this.rpc.request("getGenesisHash"); assertBase58(text(genesis), 32);
    this.network = { id: "solana", network: String(genesis) }; return structuredClone(this.network);
  }
  async getNetwork(): Promise<Web3Chain> { return this.network ? structuredClone(this.network) : this.connect(); }
  private async observation<T>(method: string, value: T, slot: number | null = null): Promise<ChainObservation<T>> {
    return { chain: await this.getNetwork(), method, value, slot, observedAt: this.clock().toISOString(), assurance: "RPC_VALIDATED", cryptographicProof: false };
  }
  async getWallet(address: string): Promise<ChainObservation> {
    assertBase58(address, 32);
    const result = object(await this.rpc.request("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "finalized" }]));
    const slot = integer(object(result.context).slot); const value = result.value;
    if (value === null) return this.observation("getAccountInfo", { address, exists: false }, slot);
    const a = object(value); assertBase58(text(a.owner), 32); if (typeof a.executable !== "boolean") throw new Web3Error("SOLANA_ACCOUNT_INVALID");
    return this.observation("getAccountInfo", { address, exists: true, owner: a.owner, executable: a.executable, lamports: unsignedAmount(a.lamports) }, slot);
  }
  async getBalance(address: string): Promise<ChainObservation> {
    assertBase58(address, 32); const r = object(await this.rpc.request("getBalance", [address, { commitment: "finalized" }]));
    return this.observation("getBalance", { address, lamports: unsignedAmount(r.value), decimals: 9, asset: "SOL" }, integer(object(r.context).slot));
  }
  async getTokenBalances(address: string): Promise<ChainObservation> {
    assertBase58(address, 32); const balances: unknown[] = []; const slots: number[] = [];
    for (const programId of SPL_PROGRAMS) {
      const r = object(await this.rpc.request("getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed", commitment: "finalized" }]));
      slots.push(integer(object(r.context).slot)); if (!Array.isArray(r.value) || r.value.length > 1000) throw new Web3Error("SOLANA_TOKEN_ACCOUNTS_INVALID");
      for (const raw of r.value) {
        const item = object(raw); const accountAddress = text(item.pubkey); assertBase58(accountAddress, 32);
        const account = object(item.account); if (account.owner !== programId) throw new Web3Error("SOLANA_TOKEN_PROGRAM_MISMATCH");
        const parsed = object(object(account.data).parsed); if (parsed.type !== "account") throw new Web3Error("SOLANA_TOKEN_ACCOUNT_TYPE_INVALID");
        const info = object(parsed.info); const mint = text(info.mint); assertBase58(mint, 32);
        if (info.owner !== address) throw new Web3Error("SOLANA_TOKEN_OWNER_MISMATCH");
        const token = object(info.tokenAmount); const amount = unsignedAmount(token.amount); const decimals = integer(token.decimals);
        if (!/^(0|[1-9][0-9]*)$/.test(amount) || decimals > 255) throw new Web3Error("SOLANA_TOKEN_AMOUNT_INVALID");
        balances.push({ address: accountAddress, mint, owner: address, amount, decimals, programId });
      }
    }
    return this.observation("getTokenAccountsByOwner", { address, balances, slots, atomicSnapshot: false }, Math.min(...slots));
  }
  async getTransaction(signature: string): Promise<ChainObservation> {
    assertBase58(signature, 64);
    const raw = await this.rpc.request("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (raw === null) return this.observation("getTransaction", { signature, found: false, status: "UNKNOWN" });
    const r = object(raw); const transaction = object(r.transaction); const meta = object(r.meta);
    if (!Array.isArray(transaction.signatures) || transaction.signatures[0] !== signature || !("err" in meta)) throw new Web3Error("SOLANA_TRANSACTION_INVALID");
    const message = object(transaction.message);
    if (!Array.isArray(message.instructions) || message.instructions.length > 1000) throw new Web3Error("SOLANA_INSTRUCTIONS_INVALID");
    const instructions = message.instructions.map((v, index) => {
      const i = object(v); assertBase58(text(i.programId), 32);
      if (i.parsed !== undefined) {
        const parsed = object(i.parsed);
        if (["transfer", "transferChecked"].includes(String(parsed.type)) && (SPL_PROGRAMS.includes(String(i.programId)) || i.programId === "11111111111111111111111111111111")) {
          const info = object(parsed.info); assertBase58(text(info.source),32); assertBase58(text(info.destination),32);
          if (i.programId === "11111111111111111111111111111111") unsignedAmount(info.lamports);
          else if (parsed.type === "transferChecked") { const token = object(info.tokenAmount); unsignedAmount(token.amount); if (integer(token.decimals) > 255) throw new Web3Error("SOLANA_TOKEN_AMOUNT_INVALID"); }
          else unsignedAmount(info.amount);
        }
      }
      return { index, programId: i.programId, ...(i.parsed === undefined ? {} : { parsed: safeMetadata(object(i.parsed)) }) };
    });
    return this.observation("getTransaction", { signature, found: true, status: meta.err === null ? "FINALIZED" : "FAILED", error: meta.err === null ? null : safeMetadata(object(meta.err)), fee: unsignedAmount(meta.fee), instructions }, integer(r.slot));
  }
  async getTransactionStatus(signature: string): Promise<ChainObservation> {
    assertBase58(signature, 64); const r = object(await this.rpc.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]));
    if (!Array.isArray(r.value) || r.value.length !== 1) throw new Web3Error("SOLANA_STATUS_INVALID");
    if (r.value[0] === null) return this.observation("getSignatureStatuses", { signature, status: "UNKNOWN" }, integer(object(r.context).slot));
    const value = object(r.value[0]);
    if (!("err" in value) || !["processed", "confirmed", "finalized"].includes(String(value.confirmationStatus))) throw new Web3Error("SOLANA_STATUS_INVALID");
    return this.observation("getSignatureStatuses", { signature, status: value.err === null ? String(value.confirmationStatus).toUpperCase() : "FAILED", error: value.err === null ? null : safeMetadata(object(value.err)) }, integer(value.slot));
  }
  async verifyTransaction(signature: string): Promise<ChainObservation> {
    const status = await this.getTransactionStatus(signature); const tx = await this.getTransaction(signature);
    const s = object(status.value); const t = object(tx.value);
    if (s.status !== "FINALIZED" || t.status !== "FINALIZED" || status.slot !== tx.slot) throw new Web3Error("SOLANA_TRANSACTION_NOT_SUCCESSFULLY_FINALIZED", 409);
    return this.observation("verifyTransaction", { signature, status: "FINALIZED", rpcConsistencyChecked: true, cryptographicProof: false }, tx.slot);
  }
  async getSlot(): Promise<ChainObservation> { const slot = integer(await this.rpc.request("getSlot", [{ commitment: "finalized" }])); return this.observation("getSlot",slot,slot); }
  async getBlock(slot: number): Promise<ChainObservation> {
    integer(slot); const raw = await this.rpc.request("getBlock", [slot, { commitment: "finalized", transactionDetails: "none", rewards: false }]);
    if (raw === null) return this.observation("getBlock", { found: false }, slot);
    const r = object(raw); assertBase58(text(r.blockhash), 32); assertBase58(text(r.previousBlockhash), 32);
    return this.observation("getBlock", { found: true, blockhash: r.blockhash, previousBlockhash: r.previousBlockhash, parentSlot: integer(r.parentSlot), blockHeight: r.blockHeight === null ? null : integer(r.blockHeight) }, slot);
  }
  async getEvents(address: string, options: WatchOptions): Promise<ChainObservation> {
    assertBase58(address, 32); if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10) throw new Web3Error("SOLANA_WATCH_LIMIT_INVALID");
    if (options.cursor) assertBase58(options.cursor, 64);
    if (options.signal?.aborted) throw new Web3Error("SOLANA_WATCH_CANCELLED");
    const raw = await this.rpc.request("getSignaturesForAddress", [address, { limit: options.limit, commitment: "finalized", ...(options.cursor ? { before: options.cursor } : {}) }]);
    if (!Array.isArray(raw) || raw.length > options.limit) throw new Web3Error("SOLANA_SIGNATURES_INVALID");
    const transactions: ChainObservation[] = [];
    for (const item of raw) { const s = object(item); const sig = text(s.signature); assertBase58(sig, 64); integer(s.slot);
      if (options.signal?.aborted) throw new Web3Error("SOLANA_WATCH_CANCELLED");
      const tx = await this.getTransaction(sig); if (tx.slot !== null && tx.slot !== s.slot) throw new Web3Error("SOLANA_WATCH_SLOT_MISMATCH"); transactions.push(tx); }
    return this.observation("getSignaturesForAddress", { address, transactions, cursor: raw.length ? object(raw[raw.length - 1]).signature : options.cursor ?? null });
  }
  async *watchAddress(address: string, options: WatchOptions): AsyncIterable<ChainObservation> { yield await this.getEvents(address, options); }
  async *watchProgram(address: string, options: WatchOptions): AsyncIterable<ChainObservation> { yield await this.getEvents(address, options); }
  // Contracts exist, but no signing, simulation claim or submission implementation is enabled.
  async simulateTransaction(_intent: Web3TransactionIntent): Promise<never> { return assertWriteUnavailable(); }
  async buildTransaction(_intent: Web3TransactionIntent): Promise<never> { return assertWriteUnavailable(); }
  async submitTransaction(_intent: Web3TransactionIntent): Promise<never> { return assertWriteUnavailable(); }
}
