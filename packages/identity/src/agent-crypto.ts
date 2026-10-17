import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import type { AgentIdentityV1, TrustSignature } from "../../contracts/src/trust";
import { canonicalJson } from "../../proof-core/src/canonical";
import { canonicalizeAiId } from "./ai-id";

export interface AgentKeyPair {
  key_id: string;
  public_key_pem: string;
  private_key_pem: string;
}

export interface CanonicalSigner {
  key_id: string;
  sign(payload: unknown): TrustSignature;
}

function keyIdFor(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 32)}`;
}

export function createAgentKeyPair(): AgentKeyPair {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    key_id: keyIdFor(publicKeyPem),
    public_key_pem: publicKeyPem,
    private_key_pem: privateKeyPem,
  };
}

export function signTrustPayload(payload: unknown, privateKeyPem: string, keyId: string): TrustSignature {
  const bytes = Buffer.from(canonicalJson(payload), "utf8");
  const signature = cryptoSign(null, bytes, createPrivateKey(privateKeyPem));
  return {
    alg: "Ed25519",
    key_id: keyId,
    value: signature.toString("base64url"),
  };
}

export function verifyTrustPayload(
  payload: unknown,
  signature: TrustSignature,
  publicKeyPem: string
): boolean {
  if (signature.alg !== "Ed25519") return false;
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(payload), "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signature.value, "base64url")
    );
  } catch {
    return false;
  }
}

export function signerFromPrivateKey(privateKeyPem: string, keyId: string): CanonicalSigner {
  return {
    key_id: keyId,
    sign: (payload) => signTrustPayload(payload, privateKeyPem, keyId),
  };
}

export function createAgentIdentityV1(input: {
  ai_id: string;
  agent_id: string;
  key_id: string;
  public_key_pem: string;
  controller: string;
  created_at: string;
  status?: "ACTIVE" | "REVOKED";
}): AgentIdentityV1 {
  const aiId = canonicalizeAiId(input.ai_id);
  const controller = canonicalizeAiId(input.controller);
  if (!input.agent_id.trim()) throw new Error("agent_id is required");
  if (!input.key_id.trim()) throw new Error("key_id is required");
  if (!input.public_key_pem.includes("BEGIN PUBLIC KEY")) throw new Error("public_key_pem must be a public key");
  return {
    schema: "osa.agent_identity.v1",
    ai_id: aiId,
    agent_id: input.agent_id.trim(),
    key_id: input.key_id,
    public_key_pem: input.public_key_pem,
    controller,
    status: input.status ?? "ACTIVE",
    created_at: input.created_at,
  };
}
