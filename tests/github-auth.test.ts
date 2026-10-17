import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { GithubAuth } from "../apps/api/src/github-auth";
import { ExecutorRegistry } from "../packages/runtime/src";
import { BrainControlPlane } from "../packages/brain/src";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";

// OAuth/NeurOSA transports are fixtures. No real credentials or LIVE login are used.
const env = {
  OSA_GITHUB_CLIENT_ID: "test-client-id", OSA_GITHUB_CLIENT_SECRET: "test-client-secret",
  OSA_SESSION_KEY: "01".repeat(32), OSA_PUBLIC_ORIGIN: "https://osa.example",
  OSA_GITHUB_ALLOWED_USER_IDS: "12345", OSA_NEUROSA_ORGANIZATION_ID: "org-test", OSA_NEUROSA_PROJECT_ID: "osa-proof",
};
const request = (cookie: string) => ({ headers: { cookie } }) as IncomingMessage;
function fixture() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let id = 12345, login = "renamed-user", failure: Response | undefined;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init?.redirect, "error");
    if (failure) return failure;
    return Response.json(String(url).endsWith("/access_token") ? { access_token: "test-private-access-token", token_type: "bearer" } : { id, login });
  };
  let time = Date.now();
  const auth = (changes = {}) => GithubAuth.fromEnvironment({ ...env, ...changes }, fetcher, () => time)!;
  return { calls, auth, advance: (ms: number) => { time += ms; }, user: (value: number) => { id = value; },
    fail: (response: Response) => { failure = response; } };
}
async function serve(auth?: GithubAuth, privateMemory = false) {
  const memory = privateMemory ? new NeurosaMemoryAdapter({ baseUrl: "https://memory.example", token: "test-token-".repeat(4),
    brainId: "OsaBrain", organizationId: "org-test", projectId: "osa-proof",
    fetch: async () => Response.json({ brainId: "OsaBrain", ledgerValid: true }) }) : undefined;
  const state = new ApiState(undefined, undefined, undefined, "session", undefined,
    memory ? new BrainControlPlane(undefined, memory) : undefined, undefined, auth);
  const server = createApiServer(new ExecutorRegistry(), state);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, state };
}
async function close(server: Server) { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
async function begin(base: string) {
  const response = await fetch(base + "/auth/github/login?return_to=https://evil.example", { redirect: "manual", headers: { host: "evil.example" } });
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get("location")!);
  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://osa.example/api/auth/github/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "read:user");
  assert.ok(!url.href.includes(env.OSA_GITHUB_CLIENT_SECRET));
  return { url, cookie: cookie.split(";")[0], state: url.searchParams.get("state")! };
}
async function finish(base: string, flow: Awaited<ReturnType<typeof begin>>, suffix = "") {
  return fetch(base + "/auth/github/callback?code=test-code&state=" + flow.state + suffix,
    { redirect: "manual", headers: { cookie: flow.cookie } });
}
function sessionCookie(response: Response) {
  const value = response.headers.getSetCookie().find(c => c.startsWith("__Host-osa_session="));
  assert.ok(value); assert.match(value, /HttpOnly; Secure; SameSite=Lax; Max-Age=3600$/);
  return value.split(";")[0];
}

test("GitHub: absent config disables login; partial/unsafe config fails closed", () => {
  assert.equal(GithubAuth.fromEnvironment({}), undefined);
  for (const changes of [{ OSA_GITHUB_CLIENT_SECRET: undefined }, { OSA_PUBLIC_ORIGIN: "http://osa.example" },
    { OSA_PUBLIC_ORIGIN: "https://osa.example/path" }, { OSA_PUBLIC_ORIGIN: "https://user:pass@osa.example" },
    { OSA_SESSION_KEY: "placeholder" }, { OSA_GITHUB_ALLOWED_USER_IDS: "username" }, { OSA_NEUROSA_PROJECT_ID: "" }]) {
    assert.throws(() => GithubAuth.fromEnvironment({ ...env, ...changes }));
  }
});

test("GitHub HTTP: PKCE login grants explicit scope; same encrypted session works after API cold start", async () => {
  const f = fixture(); let instance = await serve(f.auth(), true);
  try {
    assert.equal((await fetch(instance.base + "/memory/status").then(r => r.json())).state, "ACCESS_REQUIRED");
    const flow = await begin(instance.base), callback = await finish(instance.base, flow);
    assert.equal(callback.status, 303); assert.equal(callback.headers.get("location"), env.OSA_PUBLIC_ORIGIN + "/");
    const cookie = sessionCookie(callback);
    assert.ok(!cookie.includes("renamed-user") && !cookie.includes("test-private-access-token"));
    assert.equal(f.calls.length, 2);
    const exchange = new URLSearchParams(String(f.calls[0].init?.body));
    assert.equal(exchange.get("client_secret"), env.OSA_GITHUB_CLIENT_SECRET);
    assert.equal(exchange.get("redirect_uri"), env.OSA_PUBLIC_ORIGIN + "/api/auth/github/callback");
    assert.equal(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url"), flow.url.searchParams.get("code_challenge"));
    assert.equal(f.calls[1].url, "https://api.github.com/user");
    assert.equal((f.calls[1].init?.headers as Record<string, string>).authorization, "Bearer test-private-access-token");
    await close(instance.server); instance = await serve(f.auth(), true);
    const response = await fetch(instance.base + "/session", { headers: { cookie } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const session = await response.json();
    assert.equal(session.identity.provider, "github"); assert.equal(session.identity.subject, "github:12345");
    assert.equal(session.identity.display_name, "renamed-user"); assert.equal(session.identity.verified, true);
    assert.deepEqual(session.identity.project_ids, ["osa-proof"]); assert.equal(session.identity.organization_id, "org-test");
    const status = await fetch(instance.base + "/memory/status", { headers: { cookie } }).then(r => r.json());
    assert.equal(status.state, "AVAILABLE"); assert.equal(status.persistence_verified, false);
    assert.equal(f.calls.length, 2); // Restoring the session needs neither a token nor GitHub traffic.
    const publicStatus = await fetch(instance.base + "/auth/github/status", { headers: { cookie } }).then(r => r.json());
    assert.deepEqual(publicStatus, { enabled: true, signed_in: true, display_name: "renamed-user" });
  } finally { await close(instance.server); }
});

test("GitHub: missing/mismatched/duplicate/expired state and forged browser cookie make no upstream request", async () => {
  const f = fixture(), instance = await serve(f.auth());
  try {
    const flow = await begin(instance.base);
    for (const [change, suffix] of [[{ cookie: "" }, ""], [{ state: "forged" }, ""], [{}, "&state=duplicate"],
      [{}, "&code=duplicate"], [{ cookie: flow.cookie + "x" }, ""], [{}, "&error=access_denied"]] as const) {
      const result = await finish(instance.base, { ...flow, ...change }, suffix);
      assert.equal(result.headers.get("location"), "/?github_login=failed");
      assert.ok(result.headers.getSetCookie().every(c => !c.startsWith("__Host-osa_session=")));
    }
    f.advance(601000);
    assert.equal((await finish(instance.base, flow)).headers.get("location"), "/?github_login=failed");
    assert.equal(f.calls.length, 0);
  } finally { await close(instance.server); }
});

test("GitHub: authentic account outside server allowlist cannot gain project membership", async () => {
  const f = fixture(); f.user(99999); const instance = await serve(f.auth());
  try {
    const result = await finish(instance.base, await begin(instance.base));
    assert.equal(result.headers.get("location"), "/?github_login=access_denied");
    assert.ok(!result.headers.getSetCookie().some(c => c.startsWith("__Host-osa_session=")));
    assert.equal(f.calls.length, 2);
  } finally { await close(instance.server); }
});

test("GitHub: expiry, allowlist removal, scope/key/origin changes and tampering reject existing tickets", async () => {
  const f = fixture(), instance = await serve(f.auth());
  try {
    const cookie = sessionCookie(await finish(instance.base, await begin(instance.base)));
    assert.ok(f.auth().session(request(cookie)));
    for (const changes of [{ OSA_GITHUB_ALLOWED_USER_IDS: "99999" }, { OSA_NEUROSA_ORGANIZATION_ID: "foreign" },
      { OSA_NEUROSA_PROJECT_ID: "foreign" }, { OSA_SESSION_KEY: "02".repeat(32) }, { OSA_PUBLIC_ORIGIN: "https://other.example" }])
      assert.equal(f.auth(changes).session(request(cookie)), undefined);
    for (const bad of [cookie + "; " + cookie, cookie.replace("=", "=x"), "__Host-osa_session=invalid"])
      assert.equal(f.auth().session(request(bad)), undefined);
    f.advance(3600000); assert.equal(f.auth().session(request(cookie)), undefined);
  } finally { await close(instance.server); }
});

test("GitHub HTTP: all cookie mutations require same origin; logout clears both browser cookies", async () => {
  const f = fixture(), instance = await serve(f.auth());
  try {
    const cookie = sessionCookie(await finish(instance.base, await begin(instance.base)));
    const foreignHeaders: Record<string, string>[] = [{}, { origin: "https://evil.example" }, { origin: env.OSA_PUBLIC_ORIGIN, "sec-fetch-site": "cross-site" }];
    for (const extra of foreignHeaders) {
      const response = await fetch(instance.base + "/auth/dev-login", { method: "POST", headers: { cookie, ...extra }, body: "{}" });
      assert.equal(response.status, 403); assert.equal((await response.json()).code, "CSRF_ORIGIN_REJECTED");
    }
    const logout = await fetch(instance.base + "/session/logout", { method: "POST", headers: { cookie, origin: env.OSA_PUBLIC_ORIGIN, "sec-fetch-site": "same-origin" } });
    assert.equal(logout.status, 200); assert.deepEqual(await logout.json(), { signed_out: true });
    assert.equal(logout.headers.getSetCookie().length, 2);
    assert.ok(logout.headers.getSetCookie().every(c => c.endsWith("Max-Age=0")));
    assert.equal((await fetch(instance.base + "/session")).status, 401);
    // Stateless logout clears this browser. A copied ticket lasts until expiry/key or allowlist rotation.
    assert.ok(f.auth().session(request(cookie)));
  } finally { await close(instance.server); }
});

test("GitHub: upstream secrets, malformed/oversize JSON and redirects never leak into callback response", async () => {
  for (const bad of [Response.json({ error: "SECRET_FROM_UPSTREAM" }, { status: 500 }), new Response("not json"),
    Response.json({ token: "x".repeat(66000) }), new Response(null, { status: 302, headers: { location: "https://evil.example" } })]) {
    const f = fixture(); f.fail(bad); const instance = await serve(f.auth());
    try {
      const response = await finish(instance.base, await begin(instance.base));
      assert.equal(response.headers.get("location"), "/?github_login=failed");
      assert.ok(!(await response.text()).includes("SECRET"));
      assert.equal(f.calls.length, 1);
    } finally { await close(instance.server); }
  }
});
