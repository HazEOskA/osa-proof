import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { Mission, TeamGraph } from "../packages/contracts/src";
import { ControlError, DeploymentStore, OrganizationStore, PERMISSIONS, PolicyStore, secretStatus, verifyDeployment } from "../packages/control/src";

const CLOCK = () => new Date("2026-09-30T12:00:00.000Z");
function team(version = "1", builderRef = "dev.builder.v1"): TeamGraph {
  return {
    organization_id: "org_c", project_id: "project_c", team_id: "team_c", version,
    agents: [{ agent_id: "planner", role: "planner", executor_ref: "dev.planner.v1" }, { agent_id: "builder", role: "builder", executor_ref: builderRef }],
    edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
  };
}
const mission: Mission = {
  organization_id: "org_c", project_id: "project_c", mission_id: "m_c", team_id: "team_c", team_version: "1", objective: "Ship notes",
  entry_agent_id: "planner", input: { request: "notes" },
  requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
};

test("deployments: one ACTIVE per team and environment, supersede, rollback, promote, digest-checked", () => {
  const store = new DeploymentStore(CLOCK);
  const v1 = store.deploy({ team: team("1"), environment: "preview" });
  const v2 = store.deploy({ team: team("2"), environment: "preview" });
  assert.equal(store.get(v1.deployment_id).status, "SUPERSEDED");
  assert.equal(v2.replaces, v1.deployment_id);
  assert.equal(store.active("team_c", "preview")!.team_version, "2");
  assert.throws(() => store.deploy({ team: team("2"), environment: "preview" }), (e: unknown) => e instanceof ControlError && e.code === "conflict");
  const back = store.rollback("team_c", "preview");
  assert.equal(back.deployment_id, v1.deployment_id);
  assert.equal(store.get(v2.deployment_id).status, "ROLLED_BACK");
  assert.equal(store.active("team_c", "preview")!.team_version, "1");
  const prod = store.promote(v1.deployment_id);
  assert.equal(prod.environment, "production");
  assert.equal(prod.graph_sha256, v1.graph_sha256);
  assert.deepEqual(verifyDeployment(prod), { ok: true, errors: [] });
  const tampered = structuredClone(prod); tampered.graph.agents[0].executor_ref = "evil.v1";
  assert.equal(verifyDeployment(tampered).ok, false);
  assert.throws(() => store.deploy({ team: team("3"), environment: "staging" }), ControlError);
  assert.throws(() => store.deploy({ team: { ...team("3"), agents: [] }, environment: "preview" }), ControlError);
  assert.throws(() => store.rollback("team_c", "production"), (e: unknown) => e instanceof ControlError && e.code === "conflict");
});

test("policies: content-addressed, unknown rule refused, every enabled policy must pass (fail closed)", () => {
  const store = new PolicyStore();
  store.add({ policy_id: "small-teams", rule: { type: "max_agents", max: 3 } });
  store.add({ policy_id: "dev-executors", rule: { type: "allowed_executor_refs", refs: ["dev.planner.v1", "dev.builder.v1"] } });
  store.add({ policy_id: "has-requirements", rule: { type: "min_requirements", min: 1 } });
  assert.equal(store.evaluate(team(), mission).allowed, true);
  const denied = store.evaluate(team("1", "shell.exec.v1"), mission);
  assert.equal(denied.allowed, false);
  assert.match(denied.decisions.find((d) => d.policy_id === "dev-executors")!.reason, /builder:shell\.exec\.v1/);
  assert.equal(store.evaluate(team(), undefined).allowed, false, "min_requirements without a mission fails closed");
  assert.throws(() => store.add({ policy_id: "x", rule: { type: "allow_everything" } as never }), ControlError);
  assert.throws(() => store.add({ policy_id: "small-teams", rule: { type: "max_agents", max: 9 } }), (e: unknown) => e instanceof ControlError && e.code === "conflict");
  store.add({ policy_id: "off", rule: { type: "forbidden_roles", roles: ["planner"] }, enabled: false });
  assert.equal(store.evaluate(team(), mission).allowed, true, "disabled policies are not evaluated");
});

test("organizations and secrets: observed + registered orgs; secrets expose names and set/unset only", () => {
  const orgs = new OrganizationStore();
  orgs.register({ organization_id: "org_a", name: "Org A", projects: ["p1"] });
  const list = orgs.list([{ organization_id: "org_a", project_id: "p2" }, { organization_id: "org_b", project_id: "p9" }]);
  assert.deepEqual(list.map((o) => [o.organization_id, o.source, o.projects]), [["org_a", "registered", ["p1", "p2"]], ["org_b", "observed", ["p9"]]]);
  assert.throws(() => orgs.register({ organization_id: "org_a", name: "again" }), ControlError);
  const status = secretStatus({ ANTHROPIC_API_KEY: "sk-SECRET-VALUE", OPENAI_API_KEY: "" });
  assert.deepEqual(status.map((s) => [s.name, s.set]), [["ANTHROPIC_API_KEY", true], ["OPENAI_API_KEY", false]]);
  assert.ok(!JSON.stringify(status).includes("SECRET-VALUE"));
});

async function withServer(mode: "session" | "open", fn: (base: string) => Promise<void>) {
  const server = createApiServer(createDevFixtureRegistry(), new ApiState(undefined, undefined, undefined, mode), { mode: "fixture" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { await new Promise<void>((r) => server.close(() => r())); }
}
const json = { "content-type": "application/json" };
const post = (base: string, path: string, body: unknown, headers: Record<string, string> = json) => fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });

test("HTTP: deploy, run through the pinned deployment, policy blocks with 403, rollback", async () => {
  await withServer("open", async (base) => {
    assert.equal((await post(base, "/teams", team("1"))).status, 201);
    assert.equal((await post(base, "/teams", team("2", "dev.builder.fixture.v1"))).status, 201);
    const d1 = await (await post(base, "/deployments", { team_id: "team_c", version: "1", environment: "production" })).json() as { deployment_id: string };
    let res = await post(base, `/deployments/${d1.deployment_id}/run`, { mission: { ...mission, team_version: "999" } });
    assert.equal(res.status, 201);
    const out = await res.json() as { run: { verdict: string; proof: { team_version: string } } };
    assert.equal(out.run.verdict, "VERIFIED");
    assert.equal(out.run.proof.team_version, "1", "the deployment pins the version, not the mission");

    assert.equal((await post(base, "/policies", { policy_id: "dev-only", rule: { type: "allowed_executor_refs", refs: ["dev.planner.v1", "dev.builder.v1"] } })).status, 201);
    const d2 = await (await post(base, "/deployments", { team_id: "team_c", version: "2", environment: "production" })).json() as { deployment_id: string };
    res = await post(base, `/deployments/${d2.deployment_id}/run`, { mission });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { code: string }).code, "POLICY_DENIED");
    assert.equal((await post(base, `/deployments/${d1.deployment_id}/run`, { mission })).status, 409, "a superseded deployment does not run");

    res = await post(base, "/deployments/rollback", { team_id: "team_c", environment: "production" });
    assert.equal(((await res.json()) as { deployment_id: string }).deployment_id, d1.deployment_id);
    assert.equal((await post(base, `/deployments/${d1.deployment_id}/run`, { mission })).status, 201);
    assert.equal(((await (await fetch(base + "/deployments")).json()) as unknown[]).length, 2);
    assert.equal((await post(base, "/deployments", { team_id: "nope", version: "1", environment: "preview" })).status, 404);
    const orgs = await (await fetch(base + "/organizations")).json() as Array<{ organization_id: string }>;
    assert.ok(orgs.some((o) => o.organization_id === "org_c"), "organizations observed from teams and runs");
  });
});

test("HTTP permissions table matches enforcement: every 'session' row answers 401 without a token", async () => {
  await withServer("session", async (base) => {
    for (const row of PERMISSIONS) {
      const path = row.path.replace(":id", "x").replace("?version=", "?version=1");
      const res = await fetch(base + path, { method: row.method, headers: json, body: row.method === "GET" ? undefined : "{}" });
      if (row.enforced === "session") assert.equal(res.status, 401, `${row.method} ${row.path}`);
      else assert.notEqual(res.status, 401, `${row.method} ${row.path} is public`);
    }
    const perms = await (await fetch(base + "/permissions")).json() as { auth_mode: string; identity: unknown };
    assert.equal(perms.auth_mode, "session");
    assert.equal(perms.identity, null);
  });
});

test("queue: due jobs run on drain (now and scheduled), through a deployment with policies, failures recorded", async () => {
  let now = new Date("2026-09-30T12:00:00.000Z");
  const { JobQueue } = await import("../packages/control/src");
  const q = new JobQueue(() => now);
  const a = q.enqueue({ mission_id: "m1" });
  const later = q.enqueue({ mission_id: "m2", run_at: "2026-09-30T13:00:00.000Z" });
  assert.throws(() => q.enqueue({ mission_id: "m3", run_at: "not a date" }), ControlError);
  assert.deepEqual(q.takeDue().map((j) => j.job_id), [a.job_id], "only due jobs");
  assert.deepEqual(q.takeDue(), [], "a RUNNING job is not taken twice");
  now = new Date("2026-09-30T13:00:01.000Z");
  assert.deepEqual(q.takeDue().map((j) => j.job_id), [later.job_id]);
  assert.throws(() => q.cancel(later.job_id), (e: unknown) => e instanceof ControlError && e.code === "conflict");

  await withServer("open", async (base) => {
    assert.equal((await post(base, "/teams", team("1"))).status, 201);
    assert.equal((await post(base, "/missions", mission)).status, 201);
    const dep = await (await post(base, "/deployments", { team_id: "team_c", version: "1", environment: "production" })).json() as { deployment_id: string };
    assert.equal((await post(base, "/queue", { mission_id: "m_c" })).status, 201);
    assert.equal((await post(base, "/queue", { mission_id: "m_c", deployment_id: dep.deployment_id })).status, 201);
    assert.equal((await post(base, "/queue", { mission_id: "m_c", run_at: "2999-01-01T00:00:00.000Z" })).status, 201);
    assert.equal((await post(base, "/queue", { mission_id: "missing" })).status, 404);
    let done = await (await post(base, "/queue/drain", {})).json() as Array<{ status: string; verdict: string; run_id: string }>;
    assert.deepEqual(done.map((j) => [j.status, j.verdict]), [["DONE", "VERIFIED"], ["DONE", "VERIFIED"]], "the far-future job waits");
    assert.equal((await fetch(`${base}/runs/${done[0].run_id}/proof`)).status, 200, "a drained job points at a stored receipt");

    assert.equal((await post(base, "/policies", { policy_id: "tiny", rule: { type: "max_agents", max: 1 } })).status, 201);
    await post(base, "/queue", { mission_id: "m_c", deployment_id: dep.deployment_id });
    done = await (await post(base, "/queue/drain", {})).json() as Array<{ status: string; verdict: string; run_id: string }>;
    assert.equal(done[0].status, "FAILED");
    assert.match((done[0] as unknown as { error: string }).error, /blocked by policy: tiny/);
    const all = await (await fetch(base + "/queue")).json() as Array<{ status: string }>;
    assert.deepEqual(all.map((j) => j.status).sort(), ["DONE", "DONE", "FAILED", "QUEUED"]);
  });
});
