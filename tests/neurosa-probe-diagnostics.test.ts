import assert from "node:assert/strict";
import test from "node:test";
import { MemoryService } from "../apps/api/src/memory";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";
import { SessionStore } from "../packages/session/src";

const options = {
  baseUrl: "https://memory.example",
  token: "test-token-".repeat(4),
  brainId: "OsaBrain",
  organizationId: "org-test",
  projectId: "osa-proof",
};
const session = () => new SessionStore().create({
  identity_id: "test-diagnostic", provider: "microsoft" as const,
  subject: "microsoft:test-diagnostic", display_name: "Diagnostic",
  organization_id: "org-test", project_ids: ["osa-proof"], roles: [], verified: true
});

test("NeurOSA preview probe classifies HTTP failures without exposing remote payloads", async () => {
  for (const [status, code] of [[401, "NEUROSA_HTTP_401"], [403, "NEUROSA_HTTP_403"],
    [404, "NEUROSA_HTTP_404"], [429, "NEUROSA_HTTP_429"], [503, "NEUROSA_HTTP_5XX"]] as const) {
    const adapter = new NeurosaMemoryAdapter({ ...options,
      fetch: async () => Response.json({ details: "NEVER_EXPOSE_SECRET_OR_URL" }, { status }) });
    const result = await new MemoryService(adapter).status(session());
    assert.equal(result.state, "UNAVAILABLE");
    assert.equal(result.diagnostic_code, code);
    assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPOSE_SECRET_OR_URL|test-token|memory\.example/i);
  }
});

test("NeurOSA preview probe differentiates ledger, brain mismatch and invalid upstream JSON", async () => {
  for (const [data, code] of [[{ brainId: "other", ledgerValid: true }, "NEUROSA_BRAIN_ID_MISMATCH"],
    [{ brainId: "OsaBrain", ledgerValid: false }, "NEUROSA_LEDGER_REJECTED"]] as const) {
    const adapter = new NeurosaMemoryAdapter({ ...options, fetch: async () => Response.json(data) });
    assert.equal((await new MemoryService(adapter).status(session())).diagnostic_code, code);
  }
  const adapter = new NeurosaMemoryAdapter({ ...options,
    fetch: async () => new Response("not json", { status: 200 }) });
  assert.equal((await new MemoryService(adapter).status(session())).diagnostic_code, "NEUROSA_INVALID_RESPONSE");
});

test("NeurOSA preview probe fail-closes transport errors and still requires identity", async () => {
  const adapter = new NeurosaMemoryAdapter({ ...options,
    fetch: async () => { throw Error("PRIVATE_TOKEN https://secret.example"); } });
  const service = new MemoryService(adapter);
  const result = await service.status(session());
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.diagnostic_code, "NEUROSA_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN|secret\.example/);
  const anonymous = await service.status();
  assert.equal(anonymous.state, "ACCESS_REQUIRED");
  assert.ok(!("diagnostic_code" in anonymous));
});

test("NeurOSA preview probe safely classifies transport causes without leaking host or token", async () => {
  const cases = [
    ["ENOTFOUND", "NEUROSA_DNS_FAILED"], ["EAI_AGAIN", "NEUROSA_DNS_FAILED"],
    ["ECONNREFUSED", "NEUROSA_CONNECTION_REJECTED"], ["ECONNRESET", "NEUROSA_CONNECTION_REJECTED"],
    ["ETIMEDOUT", "NEUROSA_TIMEOUT"], ["UND_ERR_CONNECT_TIMEOUT", "NEUROSA_TIMEOUT"],
    ["CERT_HAS_EXPIRED", "NEUROSA_TLS_REJECTED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "NEUROSA_TLS_REJECTED"]
  ] as const;
  for (const [code, expected] of cases) {
    const adapter = new NeurosaMemoryAdapter({ ...options,
      fetch: async () => { throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("private hostname: https://private.example"), { code })
      }); }
    });
    const result = await new MemoryService(adapter).status(session());
    assert.equal(result.diagnostic_code, expected);
    assert.doesNotMatch(JSON.stringify(result), /private.example|test-token/i);
  }
});

test("NeurOSA preview probe returns available only after matching valid ledger", async () => {
  const adapter = new NeurosaMemoryAdapter({ ...options,
    fetch: async () => Response.json({ brainId: "OsaBrain", ledgerValid: true }) });
  const result = await new MemoryService(adapter).status(session());
  assert.equal(result.state, "AVAILABLE");
  assert.ok("brain_id" in result);
  assert.equal(result.brain_id, "OsaBrain");
  assert.ok(!("diagnostic_code" in result));
});
