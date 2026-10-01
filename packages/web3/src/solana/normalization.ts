import { ChainObservation, Web3Entity, Web3Event, Web3Scope } from "../../../contracts/src";
import { normalizeEntity } from "../entities";
import { normalizeEvent, deduplicateEvents } from "../events";
import { object, Web3Error } from "../context";
import { SPL_PROGRAMS } from "./adapter";
export function normalizeSolanaObservation(observation: ChainObservation, scope: Web3Scope): { entities: Web3Entity[]; events: Web3Event[] } {
  const entities: Web3Entity[] = []; const events: Web3Event[] = [];
  const entity = (type: Web3Entity["type"], identifier: string, metadata: Record<string, unknown>, ownership: string[] = []) => {
    const e = normalizeEntity({ type, identifier, chain: observation.chain, metadata, ownership, createdAt: observation.observedAt, tags: ["RPC_VALIDATED"] }, scope); entities.push(e); return e;
  };
  const emit = (eventType: Web3Event["eventType"], refs: string[], signature: string, payload: Record<string, unknown>) => events.push(normalizeEvent({ eventType, chain: observation.chain, entityRefs: refs, transactionRef: signature, slot: observation.slot, timestamp: observation.observedAt, payload, source: "solana.rpc", confidence: "RPC_VALIDATED" }, scope));
  entity("Chain", observation.chain.network, { assurance: observation.assurance, cryptographicProof: false });
  const value = typeof observation.value === "object" && observation.value !== null ? object(observation.value) : {};
  let wallet: Web3Entity | undefined;
  if (typeof value.address === "string") wallet = entity("Wallet", value.address, { observationMethod: observation.method, ...(typeof value.lamports === "string" ? { lamports: value.lamports } : {}) });
  if (Array.isArray(value.balances)) {
    const byMint = new Map<string, { decimals: number; amount: bigint; accounts: Record<string, unknown>[] }>();
    for (const raw of value.balances) {
      const b = object(raw); const mint = String(b.mint); const current = byMint.get(mint) ?? { decimals: Number(b.decimals), amount: 0n, accounts: [] };
      if (current.decimals !== b.decimals) throw new Web3Error("SOLANA_TOKEN_DECIMALS_MISMATCH");
      current.amount += BigInt(String(b.amount)); current.accounts.push({ tokenAccount: b.address, amount: b.amount, programId: b.programId }); byMint.set(mint,current);
    }
    for (const [mint,b] of byMint) entity("Token",mint,{ amount: b.amount.toString(),decimals: b.decimals,accounts: b.accounts },wallet ? [wallet.id] : []);
  }
  if (Array.isArray(value.transactions)) for (const nested of value.transactions as ChainObservation[]) { const result = normalizeSolanaObservation(nested, scope); entities.push(...result.entities); events.push(...result.events); }
  if (typeof value.signature === "string" && value.found === true) {
    const tx = entity("Transaction", value.signature, { status: value.status, error: value.error ?? null });
    if (value.status === "FAILED") emit("TRANSACTION_FAILED", [tx.id], value.signature, { error: value.error ?? null });
    else if (value.status === "FINALIZED") {
      emit("TRANSACTION_CONFIRMED", [tx.id], value.signature, { commitment: "finalized" });
      if (Array.isArray(value.instructions)) for (const raw of value.instructions) {
        const i = object(raw); const program = entity("Contract", String(i.programId), { kind: "solana_program" });
        emit("PROGRAM_INVOKED", [tx.id, program.id], value.signature, { instructionIndex: i.index, programId: i.programId });
        if (i.parsed && (SPL_PROGRAMS.includes(String(i.programId)) || i.programId === "11111111111111111111111111111111")) {
          const parsed = object(i.parsed); if (["transfer", "transferChecked"].includes(String(parsed.type))) {
            const info = object(parsed.info); if (typeof info.source === "string" && typeof info.destination === "string") {
              const source = entity(SPL_PROGRAMS.includes(String(i.programId)) ? "Token" : "Wallet", info.source, { role: "transfer_source" });
              const target = entity(SPL_PROGRAMS.includes(String(i.programId)) ? "Token" : "Wallet", info.destination, { role: "transfer_destination" });
              emit("TOKEN_TRANSFERRED", [tx.id, source.id, target.id], value.signature, { instructionIndex: i.index, programId: i.programId, amount: String(info.amount ?? info.lamports ?? object(info.tokenAmount ?? {}).amount ?? "UNKNOWN"), source: info.source, destination: info.destination });
            }
          }
        }
      }
    }
  }
  return { entities, events: deduplicateEvents(events) };
}
