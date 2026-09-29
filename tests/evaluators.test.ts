import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry, DEV_BUILDER_REF, DEV_PLANNER_REF } from "../apps/api/src/server";
import { Mission, RunResult, TeamGraph } from "../packages/contracts/src";
import { DatasetStore, ExampleInput, missionFromExample } from "../packages/datasets/src";
import {
  defineEvaluator,
  EvaluationObservation,
  EvaluatorError,
  EvaluatorStore,
  observationMatchesRun,
  verifyEvaluationObservation,
} from "../packages/evaluators/src";
import { createBuiltinIntelligence } from "../packages/intelligence/src";
import { OsaRuntime } from "../packages/runtime/src";

const CLOCK = () => new Date("2026-09-29T12:00:00.000Z");

const graph: TeamGraph = {
  organization_id: "org_ev", project_id: "project_ev", team_id: "team_ev", version: "1",
  agents: [
    { agent_id: "planner", role: "planner", executor_ref: DEV_PLANNER_REF },
    { agent_id: "builder", role: "builder", executor_ref: DEV_BUILDER_REF },
  ],
  edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
};
const TEAM = { organization_id: "org_ev", project_id: "project_ev", team_id: "team_ev", team_version: "1", entry_agent_id: "planner" };

function example(id: string, expected: "VERIFIED" | "FAILED" = "VERIFIED"): ExampleInput {
  return {
    example_id: id,
    objective: `Draft release notes ${id}`,
    input: { request: id },
    requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
    expected: { verdict: expected },
  };
}

function evaluators(): EvaluatorStore {
  const store = new EvaluatorStore(CLOCK);
  store.register({ evaluator_id: "verdict", spec: { type: "verdict_match" } });
  store.register({ evaluator_id: "receipt", spec: { type: "receipt_valid" } });
  store.register({ evaluator_id: "artifact-name", spec: { type: "string_check", path: "artifact", operation: "like", reference: "fixture" } });
  store.register({ evaluator_id: "built", spec: { type: "evidence_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" } });
  store.register({ evaluator_id: "review", spec: { type: "human_label", choices: [0, 0.5, 1] }, pass_threshold: 0.5 });
  return store;
}

async function datasetRun(expected: "VERIFIED" | "FAILED" = "VERIFIED") {
  const store = new DatasetStore(CLOCK);
  const version = store.create({ dataset_id: "notes", name: "Notes", examples: [example("a", expected)] });
  const run = await new OsaRuntime(createDevFixtureRegistry()).run(graph, missionFromExample(version, "a", TEAM));
  return { version, run };
}

const ALL = ["verdict", "receipt", "artifact-name", "built"];

test("deterministic evaluators score a real run; results are bound to its sealed receipt", async () => {
  const { version, run } = await datasetRun();
  const results = evaluators().evaluate(run, ALL, { dataset: version, example_id: "a" });
  assert.deepEqual(results.map((r) => [r.evaluator_id, r.score, r.passed]), ALL.map((id) => [id, 1, true]));
  for (const r of results) {
    assert.equal(r.provenance, "VERIFIER_OBSERVATION");
    assert.ok(observationMatchesRun(r, run));
    assert.deepEqual(verifyEvaluationObservation(r), { ok: true, errors: [] });
    assert.deepEqual(r.example, { dataset_id: "notes", version: 1, example_id: "a", example_sha256: version.examples[0].example_sha256 });
  }
  assert.equal(results[0].expected, "VERIFIED");
  assert.equal(results[0].observed, "VERIFIED");
});

test("same run, same evaluators -> identical observations (deterministic)", async () => {
  const { version, run } = await datasetRun();
  const a = evaluators().evaluate(run, ALL, { dataset: version, example_id: "a" });
  const b = evaluators().evaluate(run, ALL, { dataset: version, example_id: "a" });
  assert.deepEqual(a, b);
});

test("mismatches score 0 with a reason", async () => {
  const { version, run } = await datasetRun("FAILED");
  const store = evaluators();
  store.register({ evaluator_id: "exact", spec: { type: "string_check", path: "artifact", operation: "eq", reference: "other.txt" } });
  store.register({ evaluator_id: "missing", spec: { type: "string_check", path: "nope.deep", operation: "eq", reference: "x" } });
  store.register({ evaluator_id: "wrong-evidence", spec: { type: "evidence_equals", evidence_kind: "artifact", field: "status", expected: "draft" } });
  const results = store.evaluate(run, ["verdict", "exact", "missing", "wrong-evidence"], { dataset: version, example_id: "a" });
  assert.ok(results.every((r) => r.score === 0 && !r.passed), JSON.stringify(results.map((r) => r.reason)));
  assert.equal(results[0].reason, "verdict VERIFIED, expected FAILED");
  assert.equal(results[2].reason, "final_output.nope.deep is not a string");
});

test("fail closed: a tampered run scores 0 on every evaluator and cannot be labeled", async () => {
  const { version, run } = await datasetRun();
  const tampered: RunResult = structuredClone(run);
  (tampered.final_output as { artifact: string }).artifact = "forged-fixture.txt";
  const results = evaluators().evaluate(tampered, ALL, { dataset: version, example_id: "a" });
  assert.ok(results.every((r) => r.score === 0 && /^receipt integrity failed/.test(r.reason)));
  assert.throws(() => evaluators().label(tampered, { evaluator_id: "review", labeler: "ops", score: 1 }), (e: unknown) => e instanceof EvaluatorError && e.code === "conflict");
});

test("observations are tamper-evident", async () => {
  const { run } = await datasetRun();
  const [result] = evaluators().evaluate(run, ["receipt"]);
  const cases: Array<[string, (o: EvaluationObservation) => void]> = [
    ["score", (o) => { o.score = 0; o.passed = false; }],
    ["passed only", (o) => { o.passed = false; }],
    ["proof_id", (o) => { o.proof_id = "proof_other"; }],
    ["reason", (o) => { o.reason = "rewritten"; }],
  ];
  for (const [label, tamper] of cases) {
    const copy = structuredClone(result);
    tamper(copy);
    assert.equal(verifyEvaluationObservation(copy).ok, false, label);
  }
  const other = await datasetRun();
  assert.equal(observationMatchesRun(result, other.run), false, "bound to one receipt only");
});

test("human labels: scale enforced, provenance HUMAN_LABEL, deterministic evaluators refuse labels", async () => {
  const { run } = await datasetRun();
  const store = evaluators();
  const label = store.label(run, { evaluator_id: "review", labeler: "alice", score: 0.5, comment: "good enough" });
  assert.equal(label.provenance, "HUMAN_LABEL");
  assert.deepEqual(label.producer, { type: "human", labeler: "alice" });
  assert.equal(label.passed, true);
  assert.ok(verifyEvaluationObservation(label).ok && observationMatchesRun(label, run));
  assert.throws(() => store.label(run, { evaluator_id: "review", labeler: "alice", score: 0.7 }), EvaluatorError);
  assert.throws(() => store.label(run, { evaluator_id: "receipt", labeler: "alice", score: 1 }), EvaluatorError);
  assert.throws(() => store.evaluate(run, ["review"]), EvaluatorError);
  assert.equal(store.resultsFor(run.run_id).length, 1);
});

test("definitions: only deterministic or labeled types; immutable by id; content-addressed", () => {
  const bad: Array<[string, () => unknown]> = [
    ["model judge", () => defineEvaluator({ evaluator_id: "j", spec: { type: "llm_judge" } as never })],
    ["bad op", () => defineEvaluator({ evaluator_id: "s", spec: { type: "string_check", path: "a", operation: "regex" as never, reference: "x" } })],
    ["no path", () => defineEvaluator({ evaluator_id: "s", spec: { type: "string_check", path: "", operation: "eq", reference: "x" } })],
    ["label scale", () => defineEvaluator({ evaluator_id: "l", spec: { type: "human_label", choices: [1] } })],
    ["label range", () => defineEvaluator({ evaluator_id: "l", spec: { type: "human_label", choices: [0, 2] } })],
    ["threshold", () => defineEvaluator({ evaluator_id: "r", spec: { type: "receipt_valid" }, pass_threshold: 1.5 })],
    ["id", () => defineEvaluator({ evaluator_id: "has space", spec: { type: "receipt_valid" } })],
  ];
  for (const [label, attempt] of bad) assert.throws(attempt, EvaluatorError, label);
  const store = evaluators();
  assert.equal(store.register({ evaluator_id: "receipt", spec: { type: "receipt_valid" } }).evaluator_id, "receipt", "identical re-register is idempotent");
  assert.throws(() => store.register({ evaluator_id: "receipt", spec: { type: "receipt_valid" }, pass_threshold: 0.5 }), (e: unknown) => e instanceof EvaluatorError && e.code === "conflict");
  assert.notEqual(defineEvaluator({ evaluator_id: "x", spec: { type: "receipt_valid" } }).evaluator_sha256, defineEvaluator({ evaluator_id: "x", spec: { type: "receipt_valid" }, pass_threshold: 0.5 }).evaluator_sha256);
});

test("verdict_match needs an example with an expected verdict", async () => {
  const { run } = await datasetRun();
  assert.throws(() => evaluators().evaluate(run, ["verdict"]), /needs a dataset example/);
  assert.throws(() => evaluators().evaluate(run, []), EvaluatorError);
  assert.throws(() => evaluators().evaluate(run, ["unknown"]), (e: unknown) => e instanceof EvaluatorError && e.code === "not_found");
});

test("HTTP: register, evaluate a stored run against a pinned example, label, list; errors map to 400/404/409", async () => {
  const server = createApiServer(createDevFixtureRegistry(), new ApiState(createBuiltinIntelligence(CLOCK), new DatasetStore(CLOCK), new EvaluatorStore(CLOCK)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let json: Record<string, string> = { "content-type": "application/json" };
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(body) });
  try {
    const login = await post("/auth/dev-login", { display_name: "Evaluator Test", email: "eval@example.com" });
    assert.equal(login.status, 201);
    json = { ...json, authorization: `Bearer ${((await login.json()) as { session: { token: string } }).session.token}` };
    assert.equal((await post("/datasets", { dataset_id: "notes", name: "Notes", examples: [example("a")] })).status, 201);
    const mission: Mission = { ...missionFromExample((await (await fetch(`${base}/datasets/notes`)).json()), "a", TEAM) };
    assert.equal((await post("/teams", graph)).status, 201);
    assert.equal((await post("/missions", mission)).status, 201);
    const run = (await (await post(`/missions/${encodeURIComponent(mission.mission_id)}/run`, {})).json()) as RunResult;
    assert.equal(run.verdict, "VERIFIED");

    assert.equal((await post("/evaluators", { evaluator_id: "verdict", spec: { type: "verdict_match" } })).status, 201);
    assert.equal((await post("/evaluators", { evaluator_id: "review", spec: { type: "human_label", choices: [0, 1] } })).status, 201);
    assert.equal(((await (await fetch(`${base}/evaluators`)).json()) as unknown[]).length, 2);

    let res = await post(`/runs/${run.run_id}/evaluations`, { evaluator_ids: ["verdict"], example: { dataset_id: "notes", as_of: "1", example_id: "a" } });
    assert.equal(res.status, 201);
    const [result] = (await res.json()) as EvaluationObservation[];
    assert.equal(result.score, 1);
    assert.ok(verifyEvaluationObservation(result).ok, "digest survives the JSON round trip");
    assert.equal(result.proof_id, run.proof.proof_id);

    assert.equal((await post(`/runs/${run.run_id}/labels`, { evaluator_id: "review", labeler: "alice", score: 1 })).status, 201);
    res = await fetch(`${base}/runs/${run.run_id}/evaluations`, { headers: json });
    assert.deepEqual(((await res.json()) as EvaluationObservation[]).map((o) => o.provenance), ["VERIFIER_OBSERVATION", "HUMAN_LABEL"]);

    assert.equal((await fetch(`${base}/runs/${run.run_id}/evaluations`)).status, 401, "run results need a session, like the run itself");
    assert.equal((await fetch(`${base}/runs/${run.run_id}/labels`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ evaluator_id: "review", labeler: "x", score: 1 }) })).status, 401);
    assert.equal((await fetch(`${base}/evaluators/nope`)).status, 404);
    assert.equal((await post("/runs/nope/evaluations", { evaluator_ids: ["verdict"] })).status, 404);
    assert.equal((await post("/evaluators", { evaluator_id: "verdict", spec: { type: "receipt_valid" } })).status, 409);
    assert.equal((await post("/evaluators", { evaluator_id: "judge", spec: { type: "llm_judge" } })).status, 400);
    assert.equal((await post(`/runs/${run.run_id}/labels`, { evaluator_id: "review", labeler: "alice", score: 0.5 })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
