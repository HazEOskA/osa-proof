import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { TeamGraph } from "../packages/contracts/src";
import { ExampleInput } from "../packages/datasets/src";
import { Comparison, Experiment, verifyExperiment } from "../packages/experiments/src";

function team(version: string, builder: string): TeamGraph {
  return {
    organization_id: "org_x", project_id: "project_x", team_id: "team_x", version,
    agents: [{ agent_id: "planner", role: "planner", executor_ref: "dev.planner.v1" }, { agent_id: "builder", role: "builder", executor_ref: builder }],
    edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
  };
}
const example = (id: string, expected: "VERIFIED" | "FAILED" = "VERIFIED"): ExampleInput => ({
  example_id: id, objective: `Objective ${id}`, input: { request: id }, split: id === "c" ? "hold" : "test",
  requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
  expected: { verdict: expected },
});

test("HTTP: experiment runs every example through the runtime, seals the outcome, compares versions", async () => {
  const registry = createDevFixtureRegistry();
  // A second builder that never builds, to create a regression between team versions.
  registry.register("dev.builder.broken.v1", () => ({ output: {}, evidence: [{ kind: "artifact", data: { status: "draft" } }] }));
  const server = createApiServer(registry, new ApiState(undefined, undefined, undefined, "open"), { mode: "fixture" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/teams", team("1", "dev.builder.v1"))).status, 201);
    assert.equal((await post("/teams", team("2", "dev.builder.broken.v1"))).status, 201);
    assert.equal((await post("/datasets", { dataset_id: "notes", name: "Notes", examples: [example("a"), example("b"), example("c")] })).status, 201);
    assert.equal((await post("/evaluators", { evaluator_id: "verdict", spec: { type: "verdict_match" } })).status, 201);
    assert.equal((await post("/evaluators", { evaluator_id: "receipt", spec: { type: "receipt_valid" } })).status, 201);

    const req = (version: string, split?: string) => ({ dataset_id: "notes", as_of: "1", team_id: "team_x", version, evaluator_ids: ["verdict", "receipt"], split });
    let res = await post("/experiments", req("1", "test"));
    assert.equal(res.status, 201);
    const a = (await res.json()) as Experiment;
    assert.equal(a.results.length, 2, "split filters examples");
    assert.deepEqual(a.summary, { examples: 2, verified: 2, mean_scores: { verdict: 1, receipt: 1 } });
    assert.ok(verifyExperiment(a).ok, "sealed record survives the JSON round trip");
    for (const r of a.results) {
      const proof = (await (await fetch(`${base}/runs/${r.run_id}/proof`)).json()) as { proof_id: string };
      assert.equal(proof.proof_id, r.proof_id, "each example result points at a stored, sealed receipt");
    }

    const b = (await (await post("/experiments", req("2", "test"))).json()) as Experiment;
    assert.equal(b.summary.verified, 0);
    const cmp = (await (await fetch(`${base}/experiments/compare?a=${a.experiment_id}&b=${b.experiment_id}`)).json()) as Comparison;
    assert.equal(cmp.same_outcome, false);
    assert.equal(cmp.verified_delta, -2);
    assert.deepEqual(cmp.changed.map((c) => c.verdict), [{ a: "VERIFIED", b: "FAILED" }, { a: "VERIFIED", b: "FAILED" }]);
    assert.equal(cmp.mean_score_deltas.verdict, -1);
    assert.equal(cmp.mean_score_deltas.receipt, 0, "the broken version still produces valid receipts; only the verdict regresses");

    const again = (await (await post("/experiments", req("1", "test"))).json()) as Experiment;
    assert.equal(again.outcome_sha256, a.outcome_sha256, "same pins give the same outcome");
    assert.notEqual(again.experiment_id, a.experiment_id, "but a new sealed record");

    assert.equal((await post("/experiments", { ...req("1"), evaluator_ids: [] })).status, 400);
    assert.equal((await post("/experiments", { ...req("9") })).status, 404);
    assert.equal((await post("/experiments", { ...req("1"), split: "nope" })).status, 400);
    assert.equal((await fetch(`${base}/experiments/exp_missing`)).status, 404);
    assert.equal(((await (await fetch(`${base}/experiments`)).json()) as unknown[]).length, 3);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
