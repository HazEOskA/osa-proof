import { Web3Error, object } from "../context";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function assertBase58(value: string, bytes: number): void {
  if (typeof value !== "string" || value.length < bytes || value.length > bytes * 2) throw new Web3Error("SOLANA_IDENTIFIER_INVALID");
  let n = 0n;
  for (const c of value) { const i = ALPHABET.indexOf(c); if (i < 0) throw new Web3Error("SOLANA_IDENTIFIER_INVALID"); n = n * 58n + BigInt(i); }
  let size = 0; while (n) { size++; n >>= 8n; }
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  if (size + zeros !== bytes) throw new Web3Error("SOLANA_IDENTIFIER_INVALID");
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Web3Error("SOLANA_RPC_NUMBER_INVALID");
  return Number(value);
}
/** Preserve large JSON integer literals before JSON.parse can round them (Node 20 compatible). */
export function parseRPCJson(raw: string): unknown {
  const normalized = raw.replace(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (token, numeric: string | undefined) => {
    if (!numeric || /[.eE]/.test(numeric)) return token;
    if (!/^-?(0|[1-9][0-9]*)$/.test(numeric)) throw new Web3Error("SOLANA_RPC_MALFORMED", 502);
    return Number.isSafeInteger(Number(numeric)) ? token : JSON.stringify(numeric);
  });
  return JSON.parse(normalized);
}
export function unsignedAmount(value: unknown): string {
  const amount = typeof value === "number" ? String(integer(value)) : typeof value === "string" ? value : "";
  if (!/^(0|[1-9][0-9]*)$/.test(amount) || amount.length > 20 || BigInt(amount) > 18446744073709551615n) throw new Web3Error("SOLANA_AMOUNT_INVALID");
  return amount;
}
export const READ_RPC_METHODS = ["getGenesisHash", "getAccountInfo", "getBalance", "getTokenAccountsByOwner", "getTransaction", "getSignatureStatuses", "getBlock", "getSlot", "getSignaturesForAddress"] as const;
export class SolanaRPC {
  private sequence = 0;
  constructor(private readonly endpoint: string, private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 10000) {
    let u: URL; try { u = new URL(endpoint); } catch { throw new Web3Error("SOLANA_RPC_CONFIG_INVALID"); }
    if (u.protocol !== "https:" || u.username || u.password || u.hash || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Web3Error("SOLANA_RPC_CONFIG_INVALID");
  }
  async request(method: typeof READ_RPC_METHODS[number], params: unknown[] = []): Promise<unknown> {
    if (!READ_RPC_METHODS.includes(method)) throw new Web3Error("SOLANA_RPC_METHOD_DENIED", 403);
    const id = ++this.sequence; const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.endpoint, { method: "POST", redirect: "error", signal: ctl.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      if (!res.ok || !res.body) throw new Web3Error("SOLANA_RPC_UNAVAILABLE", 502);
      const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Web3Error("SOLANA_RPC_RESPONSE_TOO_LARGE", 502); } chunks.push(value); }
      let parsed: unknown;
      try { parsed = parseRPCJson(Buffer.concat(chunks).toString("utf8")); } catch { throw new Web3Error("SOLANA_RPC_MALFORMED", 502); }
      const body = object(parsed);
      if (body.jsonrpc !== "2.0" || body.id !== id || !("result" in body) || "error" in body) throw new Web3Error("SOLANA_RPC_MALFORMED_OR_ERROR", 502);
      const numbers = (v: unknown, depth = 0): void => {
        if (depth > 30) throw new Web3Error("SOLANA_RPC_TOO_DEEP", 502);
        if (typeof v === "number" && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))) throw new Web3Error("SOLANA_RPC_UNSAFE_NUMBER", 502);
        if (v && typeof v === "object") for (const x of Object.values(v)) numbers(x, depth + 1);
      };
      numbers(body.result); return body.result;
    } catch (error) { if (error instanceof Web3Error) throw error; throw new Web3Error("SOLANA_RPC_TRANSPORT_FAILED", 502); }
    finally { clearTimeout(timer); }
  }
}
