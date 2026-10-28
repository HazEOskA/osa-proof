import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { Mission, MissionRecord, TeamGraph } from "../packages/contracts/src";
import { ExecutorRegistry, FileMissionStore } from "../packages/runtime/src";
import { verifyCompletedMission } from "../packages/proof-core/src";

test("HTTP Mission Kernel persists proof and timeline across API restarts without re-executing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-mission-api-"));
  const registry = new ExecutorRegistry();
  let executions = 0;
  registry.register("builder", () => { executions++; return { output: { built: true }, evidence: [{ kind: "build", data: { passed: true } }] }; });
  const graph: TeamGraph = { organization_id: "org_dev_local", project_id: "project", team_id: "team", version: "1", agents: [{ agent_id: "builder", role: "builder", executor_ref: "builder" }], edges: [] };
  const mission: Mission = { organization_id: "org_dev_local", project_id: "project", mission_id: "mission", team_id: "team", team_version: "1", entry_agent_id: "builder", objective: "build", input: {}, requirements: [{ requirement_id: "build", type: "evidence_field_equals", evidence_kind: "build", field: "passed", expected: true }] };
  const makeServer = () => createApiServer(registry, new ApiState(undefined, undefined, undefined, "session", new FileMissionStore(directory)));
  let server = makeServer();
  async function start(): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  async function close(): Promise<void> { await new Promise<void>((resolve) => server.close(() => resolve())); }
  async function login(base: string): Promise<Record<string, string>> {
    const response = await fetch(`${base}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: "test" }) });
    const data = await response.json() as { session: { token: string } };
    return { "content-type": "application/json", authorization: `Bearer ${data.session.token}` };
  }
  try {
    let base = await start(), headers = await login(base);
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal((await post("/missions", mission)).status, 404);
    assert.equal((await post("/teams", graph)).status, 201);
    assert.equal((await post("/missions", mission)).status, 201);
    assert.equal((await post("/missions", mission)).status, 409);
    assert.equal((await fetch(`${base}/missions/mission/receipt`, { headers })).status, 404);
    assert.equal((await post("/missions/mission/run", {})).status, 201);
    const completed = await (await fetch(`${base}/missions/mission`, { headers })).json() as MissionRecord;
    verifyCompletedMission(completed);
    assert.equal((await post("/missions/mission/cancel", {})).status, 409);
    await close(); server = makeServer(); base = await start(); headers = await login(base);
    for (const path of ["/missions/mission", "/missions/mission/timeline", "/missions/mission/run", "/missions/mission/receipt"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 401);
      assert.equal((await fetch(`${base}${path}`, { headers })).status, 200);
    }
    assert.equal((await post("/missions/mission/run", {})).status, 201);
    assert.equal(executions, 1);
    const status = await (await fetch(`${base}/build/status`)).json() as { mission_persistence: string; persistence: string };
    assert.equal(status.mission_persistence, "LOCAL_FILESYSTEM");
    assert.equal(status.persistence, "PROCESS_MEMORY");
  } finally { await close(); await rm(directory, { recursive: true, force: true }); }
});

test("trusted identities cannot access or overwrite another project in the same organization", async () => {
  const registry = new ExecutorRegistry();
  registry.register("reader", () => ({ output: {}, evidence: [{ kind: "check", data: { ok: true } }] }));
  const state = new ApiState(undefined, undefined, undefined, "session");
  const identity = (project: string) => ({ identity_id: `user-${project}`, provider: "github" as const, subject: `user-${project}`,
    display_name: project, verified: true, roles: [], organization_id: "org-a", project_ids: [project] });
  const headers = (project: string) => ({ "content-type": "application/json", authorization: `Bearer ${state.sessions.create(identity(project)).token}` });
  const a = headers("project-a"), b = headers("project-b");
  const server = createApiServer(registry, state);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, auth: Record<string, string>) => fetch(base + path, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const graph: TeamGraph = { organization_id: "org-a", project_id: "project-a", team_id: "team-a", version: "1",
    agents: [{ agent_id: "reader", role: "reader", executor_ref: "reader" }], edges: [] };
  const mission: Mission = { organization_id: "org-a", project_id: "project-a", mission_id: "mission-a", team_id: graph.team_id,
    team_version: graph.version, entry_agent_id: "reader", objective: "read", input: {},
    requirements: [{ requirement_id: "checked", type: "evidence_field_equals", evidence_kind: "check", field: "ok", expected: true }] };
  try {
    assert.equal((await post("/teams", graph, a)).status, 201);
    assert.equal((await post("/teams", graph, b)).status, 403);
    assert.equal((await post("/teams", { ...graph, project_id: "project-b" }, b)).status, 409);
    assert.equal((await fetch(`${base}/teams/team-a?version=1`, { headers: b })).status, 403);
    assert.equal((await post("/missions", mission, b)).status, 403);
    assert.equal((await post("/missions", mission, a)).status, 201);
    for (const suffix of ["", "/timeline", "/run", "/receipt", "/plan"]) {
      assert.equal((await fetch(`${base}/missions/mission-a${suffix}`, { headers: b })).status, 403);
    }
    assert.equal((await post("/missions/mission-a/run", {}, b)).status, 403);
    const response = await post("/missions/mission-a/run", {}, a);
    assert.equal(response.status, 201);
    const run = await response.json() as { run_id: string };
    for (const suffix of ["", "/events", "/evidence", "/proof"]) {
      assert.equal((await fetch(`${base}/runs/${run.run_id}${suffix}`, { headers: b })).status, 403);
      assert.equal((await fetch(`${base}/runs/${run.run_id}${suffix}`, { headers: a })).status, 200);
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
