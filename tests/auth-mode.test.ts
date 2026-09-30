import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, AuthConfigError, AuthMode, createApiServer, loadAuthMode } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";

async function withServer(mode: AuthMode, fn: (base: string) => Promise<void>): Promise<void> {
  const server = createApiServer(createDevFixtureRegistry(), new ApiState(undefined, undefined, undefined, mode), { mode: "fixture" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const graph = {
  organization_id: "org_auth", project_id: "project_auth", team_id: "team_auth", version: "1",
  agents: [{ agent_id: "planner", role: "planner", executor_ref: "dev.planner.v1" }, { agent_id: "builder", role: "builder", executor_ref: "dev.builder.v1" }],
  edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
};
const json = { "content-type": "application/json" };

test("OSA_AUTH_MODE fails closed: unset is session, only session or open accepted", () => {
  assert.equal(loadAuthMode({}), "session");
  assert.equal(loadAuthMode({ OSA_AUTH_MODE: " session " }), "session");
  assert.equal(loadAuthMode({ OSA_AUTH_MODE: "open" }), "open");
  for (const value of ["OPEN", "none", "off", "true"]) {
    assert.throws(() => loadAuthMode({ OSA_AUTH_MODE: value }), AuthConfigError, value);
  }
});

test("session mode (default): writes, runs and the build workspace need a session", async () => {
  await withServer("session", async (base) => {
    assert.equal((await fetch(`${base}/teams`, { method: "POST", headers: json, body: JSON.stringify(graph) })).status, 401);
    assert.equal((await fetch(`${base}/build/workspace`)).status, 401);
    assert.equal((await fetch(`${base}/build/workspace`, { method: "POST", headers: json, body: "{}" })).status, 401);
    assert.equal((await fetch(`${base}/layers/dev/enter`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/session`)).status, 401);
    assert.equal(((await (await fetch(`${base}/build/status`)).json()) as { auth_mode: string }).auth_mode, "session");
  });
});

test("open mode: no login needed, identity is the explicit OPEN MODE identity, status says so", async () => {
  await withServer("open", async (base) => {
    assert.equal((await fetch(`${base}/teams`, { method: "POST", headers: json, body: JSON.stringify(graph) })).status, 201);
    assert.equal((await fetch(`${base}/layers/dev/enter`, { method: "POST" })).status, 200);
    const session = (await (await fetch(`${base}/session`)).json()) as { identity: { identity_id: string; display_name: string } };
    assert.equal(session.identity.identity_id, "idn_open_mode");
    assert.match(session.identity.display_name, /OPEN MODE/);
    const status = (await (await fetch(`${base}/build/status`)).json()) as { auth_mode: string; executors: string[] };
    assert.equal(status.auth_mode, "open");
    assert.ok(status.executors.includes("dev.planner.v1") && status.executors.includes("dev.builder.v1"), "registered executor refs are reported");
    assert.deepEqual(status.executors, [...status.executors].sort());
    // Regulated layers stay gated whatever the auth mode.
    assert.equal(((await (await fetch(`${base}/layers/bank/enter`, { method: "POST" })).json()) as { decision: string }).decision, "GATED");
  });
});

test("the Vercel preview sets OSA_AUTH_MODE=open; nothing else does", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { env: Record<string, string> };
  assert.equal(vercel.env.OSA_AUTH_MODE, "open");
});
