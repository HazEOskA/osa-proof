import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createApiServer } from "../apps/api/src";
import { createLocalDevIdentity } from "../packages/identity/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import { SessionStore } from "../packages/session/src";

test("local DEV identity is verified and deterministic for the same subject", () => {
  const a = createLocalDevIdentity({ display_name: "Osa Dev", email: "OSA@example.com" });
  const b = createLocalDevIdentity({ display_name: "Different Label", email: "osa@example.com" });
  assert.equal(a.provider, "local-dev");
  assert.equal(a.verified, true);
  assert.equal(a.email, "osa@example.com");
  assert.equal(a.identity_id, b.identity_id);
  assert.ok(a.roles.includes("developer"));
});

test("SessionStore creates, resolves, and revokes authenticated sessions", () => {
  const store = new SessionStore();
  const identity = createLocalDevIdentity({ display_name: "Session Test" });
  const session = store.create(identity);
  assert.match(session.session_id, /^ses_/);
  assert.match(session.token, /^osa_dev_/);
  assert.equal(store.get(session.token)?.identity.identity_id, identity.identity_id);
  assert.equal(store.revoke(session.token), true);
  assert.equal(store.get(session.token), undefined);
});

test("HTTP DEV login creates a session that authorizes DEV and can be revoked", async () => {
  const server = createApiServer(new ExecutorRegistry());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    let response = await fetch(`${base}/auth/providers`);
    assert.equal(response.status, 200);
    const providers = (await response.json()) as Array<{ provider: string; enabled: boolean }>;
    assert.equal(providers.find((item) => item.provider === "local-dev")?.enabled, true);
    assert.equal(providers.find((item) => item.provider === "github")?.enabled, false);

    response = await fetch(`${base}/teams`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${base}/auth/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Gatekeeper Test", email: "gate@example.com" }),
    });
    assert.equal(response.status, 201);
    const login = (await response.json()) as {
      identity: { verified: boolean; display_name: string };
      session: { token: string };
    };
    assert.equal(login.identity.verified, true);
    const auth = { authorization: `Bearer ${login.session.token}` };

    response = await fetch(`${base}/session`, { headers: auth });
    assert.equal(response.status, 200);
    const current = (await response.json()) as { identity: { display_name: string } };
    assert.equal(current.identity.display_name, "Gatekeeper Test");

    response = await fetch(`${base}/layers/dev/enter`, { method: "POST", headers: auth });
    assert.equal(response.status, 200);
    const entry = (await response.json()) as { decision: string };
    assert.equal(entry.decision, "ALLOWED");

    response = await fetch(`${base}/session/logout`, { method: "POST", headers: auth });
    assert.equal(response.status, 200);
    response = await fetch(`${base}/session`, { headers: auth });
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
