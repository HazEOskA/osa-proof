import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActionReceiptV1, AgentIdentityV1 } from "../../../packages/contracts/src";
import { canonicalizeAiId, parseAiId } from "../../../packages/identity/src/ai-id";
import { verifyActionReceiptV1 } from "../../../packages/runtime/src/trust";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJsonLimited<T>(request: IncomingMessage, maxBytes = 262144): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw new Error("TRUST_BODY_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function buildAiProfile(env: Record<string, string | undefined>) {
  const authority = env.OSA_AI_AUTHORITY?.trim();
  const canonical = env.OSA_AI_CANONICAL_URL?.trim();
  if (!authority || !canonical) return null;

  const id = canonicalizeAiId(`@ai:${authority}`);
  const parsed = parseAiId(id);
  if (parsed.profile_path.length !== 0) throw new Error("OSA_AI_AUTHORITY must be a root DNS authority");

  const links: Array<Record<string, string>> = [{ rel: "human", href: canonical }];
  const proofUrl = env.OSA_AI_PROOF_URL?.trim();
  if (proofUrl) links.push({ rel: "proof", href: proofUrl });

  return {
    spec: "ai-profile/0.1",
    id,
    type: "organization",
    name: env.OSA_AI_NAME?.trim() || "OSA Proof",
    description:
      env.OSA_AI_DESCRIPTION?.trim() ||
      "Proof-first infrastructure for verifiable agent execution.",
    canonical,
    links,
  };
}

export async function handleTrustRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  const method = request.method ?? "GET";

  if (url.pathname === "/.well-known/ai-profile.json") {
    if (method !== "GET") {
      send(response, 405, { error: "method not allowed", code: "TRUST_METHOD_NOT_ALLOWED" });
      return true;
    }
    try {
      const profile = buildAiProfile(env);
      if (!profile) {
        send(response, 503, { error: "AI profile is not configured", code: "AI_PROFILE_NOT_CONFIGURED" });
      } else {
        send(response, 200, profile);
      }
    } catch {
      send(response, 500, { error: "AI profile configuration is invalid", code: "AI_PROFILE_INVALID" });
    }
    return true;
  }

  if (url.pathname === "/trust/status" && method === "GET") {
    send(response, 200, {
      trust_fabric: "0.1",
      proof_receipt: "osa.proof_receipt.v2",
      capabilities: [
        "@ai-identity",
        "ed25519-signatures",
        "delegation",
        "runtime-attestation",
        "action-receipts",
        "merkle-batching",
        "chain-anchor-interface",
      ],
      live_blockchain_transactions: false,
    });
    return true;
  }

  if (url.pathname === "/trust/verify/action" && method === "POST") {
    try {
      const body = await readJsonLimited<{ identity: AgentIdentityV1; receipt: ActionReceiptV1 }>(request);
      if (!body?.identity || !body?.receipt) {
        send(response, 400, { ok: false, errors: ["identity and receipt are required"] });
        return true;
      }
      send(response, 200, verifyActionReceiptV1(body.receipt, body.identity));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "TRUST_BODY_TOO_LARGE" ? 413 : 400;
      send(response, status, { ok: false, errors: [message === "TRUST_BODY_TOO_LARGE" ? message : "invalid request"] });
    }
    return true;
  }

  return false;
}
