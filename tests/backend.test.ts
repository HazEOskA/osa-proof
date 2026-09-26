import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AddressInfo } from "node:net";
import { createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { Mission, TeamGraph } from "../packages/contracts/src";
import { JsonlEventStore } from "../packages/events/src";
import { ExecutorRegistry, OsaRuntime } from "../packages/runtime/src";
import { TeamGraphValidationError, validateTeamGraph } from "../packages/team-graph/src";

const graph: TeamGraph = {
  organization_id: "org_local",
  project_id: "project_slice_1",
  team_id: "team_builder",
  version: "1",
  agents: [
    { agent_id: "planner", role: "planner", executor_ref: "planner.v1" },
    { agent_id: "builder", role: "builder", executor_ref: "builder.v1" },
  ],
  edges: [
    {
      edge_id: "planner_to_builder",
      from_agent_id: "planner",
      to_agent_id: "builder",
      kind: "handoff",
    },
  ],
};

function mission(expected = "built"): Mission {
  return {
    organization_id: "org_local",
    project_id: "project_slice_1",
    mission_id: `mission_${expected}`,
    team_id: graph.team_id,
    team_version: graph.version,
    objective: "build a verified artifact",
    entry_agent_id: "planner",
    input: { request: "build artifact" },
    requirements: [
      {
        requirement_id: "artifact_status",
        type: "evidence_field_equals",
        evidence_kind: "artifact",
        agent_id: "builder",
        field: "status",
        expected,
      },
    ],
  };
}

async function devAuthHeaders(base: string): Promise<Record<string, string>> {
  const response = await fetch(`${base}/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ display_name: "Local DEV Test", email: "dev@example.com" }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { session: { token: string } };
  return { "content-type": "application/json", authorization: `Bearer ${body.session.token}` };
}

function registry(): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register("planner.v1", ({ input }) => ({
    output: { plan: "build", received: input },
    evidence: [{ kind: "plan", data: { status: "ready" } }],
  }));
  registry.register("builder.v1", ({ input }) => ({
    output: { artifact: "artifact.txt", upstream: input },
    evidence: [{ kind: "artifact", data: { status: "built", artifact: "artifact.txt" } }],
  }));
  return registry;
}

test("Team Graph rejects edges that reference unknown agents", () => {
  const invalid: TeamGraph = {
    ...graph,
    edges: [{ ...graph.edges[0], to_agent_id: "ghost" }],
  };
  assert.throws(() => validateTeamGraph(invalid), TeamGraphValidationError);
});

test("two-agent handoff produces runtime evidence and VERIFIED proof", async () => {
  const runtime = new OsaRuntime(registry());
  const result = await runtime.run(graph, mission("built"));

  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.proof.verdict, "VERIFIED");
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(
    result.events.filter((event) => event.type === "AGENT_STARTED").map((event) => event.agent_id),
    ["planner", "builder"]
  );
  assert.equal(result.events.filter((event) => event.type === "HANDOFF_CREATED").length, 1);
  assert.equal(result.events.at(-1)?.type, "RUN_VERIFIED");
});

test("produced evidence with wrong value yields FAILED, not model-claimed success", async () => {
  const runtime = new OsaRuntime(registry());
  const result = await runtime.run(graph, mission("deployed"));
  assert.equal(result.verdict, "FAILED");
  assert.equal(result.proof.requirement_verdicts[0].verdict, "FAILED");
  assert.equal(result.events.at(-1)?.type, "RUN_FAILED");
});

test("missing required evidence yields INCOMPLETE", async () => {
  const missingRegistry = new ExecutorRegistry();
  missingRegistry.register("planner.v1", () => ({ output: {}, evidence: [] }));
  missingRegistry.register("builder.v1", () => ({ output: { claim: "done" }, evidence: [] }));
  const runtime = new OsaRuntime(missingRegistry);
  const result = await runtime.run(graph, mission("built"));
  assert.equal(result.verdict, "INCOMPLETE");
  assert.equal(result.evidence.length, 0);
  assert.equal(result.events.at(-1)?.type, "RUN_INCOMPLETE");
});


test("mission without acceptance requirements is rejected", async () => {
  const runtime = new OsaRuntime(registry());
  const noRequirements = { ...mission("built"), requirements: [] };
  await assert.rejects(() => runtime.run(graph, noRequirements), TeamGraphValidationError);
});

test("runtime execution failure can never produce VERIFIED", async () => {
  const failingRegistry = new ExecutorRegistry();
  failingRegistry.register("planner.v1", () => ({
    output: { plan: "build" },
    evidence: [{ kind: "artifact", data: { status: "built" } }],
  }));
  failingRegistry.register("builder.v1", () => {
    throw new Error("builder crashed");
  });

  const runtime = new OsaRuntime(failingRegistry);
  const acceptsPlannerEvidence = mission("built");
  acceptsPlannerEvidence.requirements[0].agent_id = "planner";
  const result = await runtime.run(graph, acceptsPlannerEvidence);

  assert.equal(result.verdict, "FAILED");
  assert.equal(result.proof.requirement_verdicts.at(-1)?.requirement_id, "__runtime_execution__");
  assert.ok(result.events.some((event) => event.type === "AGENT_FAILED" && event.agent_id === "builder"));
  assert.equal(result.events.at(-1)?.type, "RUN_FAILED");
});

test("JSONL event store persists runtime events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "osa-proof-"));
  const file = join(dir, "events.jsonl");
  try {
    const runtime = new OsaRuntime(registry(), { eventStore: new JsonlEventStore(file) });
    const result = await runtime.run(graph, mission("built"));
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, result.events.length);
    assert.ok(lines.some((line) => line.includes("EVIDENCE_RECORDED")));
    assert.ok(lines.some((line) => line.includes("RUN_VERIFIED")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("minimal HTTP API exposes team, run, events, evidence and proof", async () => {
  const server = createApiServer(registry());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const authHeaders = await devAuthHeaders(base);
    let response = await fetch(`${base}/teams`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(graph),
    });
    assert.equal(response.status, 201);

    const currentMission = mission("built");
    response = await fetch(`${base}/missions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(currentMission),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${base}/missions/${currentMission.mission_id}/run`, { method: "POST", headers: authHeaders });
    assert.equal(response.status, 201);
    const run = (await response.json()) as { run_id: string; verdict: string };
    assert.equal(run.verdict, "VERIFIED");

    for (const suffix of ["", "/events", "/evidence", "/proof"]) {
      response = await fetch(`${base}/runs/${run.run_id}${suffix}`, { headers: authHeaders });
      assert.equal(response.status, 200);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("DEV production fixture registry completes Team Graph -> Mission -> RUN -> Events -> Evidence -> Proof", async () => {
  const devGraph: TeamGraph = {
    organization_id: "org_dev_fixture",
    project_id: "project_dev_live_slice",
    team_id: "team_dev_fixture",
    version: "1",
    agents: [
      { agent_id: "planner", role: "planner", executor_ref: "dev.planner.fixture.v1" },
      { agent_id: "builder", role: "builder", executor_ref: "dev.builder.fixture.v1" },
    ],
    edges: [
      {
        edge_id: "planner_to_builder",
        from_agent_id: "planner",
        to_agent_id: "builder",
        kind: "handoff",
      },
    ],
  };

  const devMission: Mission = {
    organization_id: devGraph.organization_id,
    project_id: devGraph.project_id,
    mission_id: "mission_dev_acceptance",
    team_id: devGraph.team_id,
    team_version: devGraph.version,
    objective: "Build a proof-first DEV artifact from user input",
    entry_agent_id: "planner",
    input: { request: "Build a proof-first DEV artifact from user input" },
    requirements: [
      {
        requirement_id: "artifact_status",
        type: "evidence_field_equals",
        evidence_kind: "artifact",
        agent_id: "builder",
        field: "status",
        expected: "built",
      },
    ],
  };

  const server = createApiServer(createDevFixtureRegistry());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const authHeaders = await devAuthHeaders(base);
    let response = await fetch(`${base}/teams`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(devGraph),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${base}/missions`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(devMission),
    });
    assert.equal(response.status, 201);

    response = await fetch(`${base}/missions/${devMission.mission_id}/run`, { method: "POST", headers: authHeaders });
    assert.equal(response.status, 201);
    const run = (await response.json()) as { run_id: string; verdict: string };
    assert.equal(run.verdict, "VERIFIED");

    const eventsResponse = await fetch(`${base}/runs/${run.run_id}/events`, { headers: authHeaders });
    const evidenceResponse = await fetch(`${base}/runs/${run.run_id}/evidence`, { headers: authHeaders });
    const proofResponse = await fetch(`${base}/runs/${run.run_id}/proof`, { headers: authHeaders });

    assert.equal(eventsResponse.status, 200);
    assert.equal(evidenceResponse.status, 200);
    assert.equal(proofResponse.status, 200);

    const events = (await eventsResponse.json()) as Array<{ type: string }>;
    const evidence = (await evidenceResponse.json()) as Array<{ kind: string }>;
    const proof = (await proofResponse.json()) as { verdict: string; proof_id: string };

    assert.ok(events.some((event) => event.type === "RUN_VERIFIED"));
    const artifactEvidence = evidence.find((record) => record.kind === "artifact") as
      | { data?: { objective?: string } }
      | undefined;
    assert.equal(artifactEvidence?.data?.objective, devMission.objective);
    assert.equal(proof.verdict, "VERIFIED");
    assert.match(proof.proof_id, /^proof_/);

    const runResponse = await fetch(`${base}/runs/${run.run_id}`, { headers: authHeaders });
    assert.equal(runResponse.status, 200);
    const storedRun = (await runResponse.json()) as {
      final_output?: { objective?: string; upstream?: { received?: { request?: string } } };
    };
    assert.equal(storedRun.final_output?.objective, devMission.objective);
    assert.equal(storedRun.final_output?.upstream?.received?.request, devMission.objective);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("DEV web surface exposes mission input, RUN NOW, and live proof outputs", async () => {
  const [html, apiClient] = await Promise.all([
    readFile(join(process.cwd(), "apps/web/dev/index.html"), "utf8"),
    readFile(join(process.cwd(), "apps/web/assets/osa-api-client.js"), "utf8"),
  ]);

  assert.match(html, /id="gatekeeper"/);
  assert.match(html, /OSA · GATEKEEPER/);
  assert.match(html, /id="gate-login"/);
  assert.match(html, /bootstrapSession\(\)/);
  assert.match(html, /id="mission-input"/);
  assert.match(html, /id="run-now"/);
  assert.match(html, /id="result-output"/);
  assert.match(html, /id="events-output"/);
  assert.match(html, /id="evidence-output"/);
  assert.match(html, /id="proof-output"/);
  assert.match(html, /window\.OSA_API\.runDevMission\(objective\)/);
  assert.match(apiClient, /async loginDev\(displayName, email = ""\)/);
  assert.match(apiClient, /getSession\(\)/);
  assert.match(apiClient, /async logout\(\)/);
  assert.match(apiClient, /async runDevMission\(objective\)/);
  assert.match(apiClient, /this\.getRunEvents\(run\.run_id\)/);
  assert.match(apiClient, /this\.getRunEvidence\(run\.run_id\)/);
  assert.match(apiClient, /this\.getRunProof\(run\.run_id\)/);
});
