import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { DatasetError, DatasetStore, DatasetVersion, ExampleInput, MAX_EXAMPLES, missionFromExample, verifyDatasetVersion } from "../packages/datasets/src";
import { createBuiltinIntelligence } from "../packages/intelligence/src";
import { digest } from "../packages/proof-core/src";
import { ExecutorRegistry, OsaRuntime } from "../packages/runtime/src";
import { TeamGraph } from "../packages/contracts/src";

const CLOCK = () => new Date("2026-09-29T12:00:00.000Z");

function example(id: string, objective = `Objective ${id}`, extra: Partial<ExampleInput> = {}): ExampleInput {
  return {
    example_id: id,
    objective,
    input: { request: objective },
    requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
    expected: { verdict: "VERIFIED" },
    split: "test",
    ...extra,
  };
}

function seeded(): DatasetStore {
  const store = new DatasetStore(CLOCK);
  store.create({ dataset_id: "release-notes", name: "Release notes", description: "Missions for release notes", examples: [example("a"), example("b")] });
  return store;
}

test("versioning: every change creates a new immutable version; old versions stay readable", () => {
  const store = seeded();
  const v2 = store.commit("release-notes", { upsert: [example("c")], message: "add c" });
  const v3 = store.commit("release-notes", { upsert: [example("a", "Objective a, revised")], message: "revise a" });
  const v4 = store.commit("release-notes", { remove: ["b"], message: "drop b" });
  assert.deepEqual([v2.version, v3.version, v4.version], [2, 3, 4]);
  assert.deepEqual([v2.parent_version, v3.parent_version, v4.parent_version], [1, 2, 3]);
  assert.deepEqual(store.get("release-notes", 1).examples.map((e) => e.example_id), ["a", "b"]);
  assert.equal(store.get("release-notes", 2).examples.find((e) => e.example_id === "a")!.objective, "Objective a");
  assert.equal(store.get("release-notes", 3).examples.find((e) => e.example_id === "a")!.objective, "Objective a, revised");
  assert.deepEqual(store.get("release-notes").examples.map((e) => e.example_id), ["a", "c"]);
  assert.deepEqual(store.listVersions("release-notes").map((v) => v.message), ["create", "add c", "revise a", "drop b"]);
});

test("versioning: returned versions cannot mutate the store", () => {
  const store = seeded();
  const copy = store.get("release-notes");
  (copy.examples[0] as { objective: string }).objective = "mutated";
  assert.equal(store.get("release-notes").examples[0].objective, "Objective a");
  assert.ok(verifyDatasetVersion(store.get("release-notes")).ok);
});

test("tags pin a version and can move; experiments read by tag, number or latest", () => {
  const store = seeded();
  store.tag("release-notes", "prod", 1);
  store.commit("release-notes", { upsert: [example("c")] });
  assert.equal(store.get("release-notes", "prod").version, 1);
  assert.equal(store.get("release-notes", "2").version, 2);
  assert.equal(store.get("release-notes", "latest").version, 2);
  store.tag("release-notes", "prod", 2);
  assert.equal(store.get("release-notes", "prod").version, 2);
  assert.deepEqual(store.listVersions("release-notes").map((v) => v.tags), [[], ["prod"]]);
  assert.throws(() => store.tag("release-notes", "7", 1), DatasetError);
  assert.throws(() => store.tag("release-notes", "latest", 1), DatasetError);
  assert.throws(() => store.get("release-notes", "missing-tag"), (e: unknown) => e instanceof DatasetError && e.code === "not_found");
});

test("content digests: per example, order-independent root, bound version hash", () => {
  const a = new DatasetStore(CLOCK).create({ dataset_id: "d", name: "D", examples: [example("x"), example("y")] });
  const b = new DatasetStore(CLOCK).create({ dataset_id: "d", name: "D", examples: [example("y"), example("x")] });
  assert.equal(a.examples_root, b.examples_root);
  assert.equal(a.version_sha256, b.version_sha256);
  const { example_sha256, ...body } = a.examples[0];
  assert.equal(example_sha256, digest(body));
  assert.deepEqual(verifyDatasetVersion(a), { ok: true, errors: [] });
});

test("content digests: any tampering is detected", () => {
  const version = seeded().get("release-notes");
  const cases: Array<[string, (v: DatasetVersion) => void]> = [
    ["objective", (v) => { (v.examples[0] as { objective: string }).objective = "forged"; }],
    ["expected verdict", (v) => { v.examples[0].expected = { verdict: "FAILED" }; }],
    ["example hash rewritten", (v) => { const { example_sha256: _s, ...rest } = v.examples[0]; (v.examples[0] as { objective: string }).objective = "forged"; v.examples[0].example_sha256 = digest({ ...rest, objective: "forged" }); }],
    ["message", (v) => { v.message = "rewritten history"; }],
    ["dropped example", (v) => { v.examples.pop(); }],
  ];
  for (const [label, tamper] of cases) {
    const copy = structuredClone(version);
    tamper(copy);
    assert.equal(verifyDatasetVersion(copy).ok, false, label);
  }
});

test("validation refuses bad input whole (no partial commits)", () => {
  const store = seeded();
  const bad: Array<[string, () => unknown]> = [
    ["no requirements", () => store.commit("release-notes", { upsert: [example("c", "x", { requirements: [] })] })],
    ["bad id", () => store.commit("release-notes", { upsert: [example("has space")] })],
    ["bad verdict", () => store.commit("release-notes", { upsert: [example("c", "x", { expected: { verdict: "MAYBE" as never } })] })],
    ["non-canonical input", () => store.commit("release-notes", { upsert: [example("c", "x", { input: { n: Number.NaN } })] })],
    ["duplicate in commit", () => store.commit("release-notes", { upsert: [example("c"), example("c")] })],
    ["remove missing", () => store.commit("release-notes", { remove: ["zzz"] })],
    ["upsert and remove", () => store.commit("release-notes", { upsert: [example("a")], remove: ["a"] })],
    ["empty version", () => store.commit("release-notes", { remove: ["a", "b"] })],
    ["no-op", () => store.commit("release-notes", { upsert: [example("a")] })],
    ["duplicate dataset", () => store.create({ dataset_id: "release-notes", name: "x", examples: [example("a")] })],
    ["empty create", () => new DatasetStore().create({ dataset_id: "e", name: "E", examples: [] })],
  ];
  for (const [label, attempt] of bad) assert.throws(attempt, DatasetError, label);
  assert.equal(store.listVersions("release-notes").length, 1, "nothing was committed");
  assert.equal(MAX_EXAMPLES, 10_000);
});

test("pinned example runs as a mission through the real runtime", async () => {
  const version = seeded().get("release-notes");
  const graph: TeamGraph = {
    organization_id: "org_ds", project_id: "project_ds", team_id: "team_ds", version: "1",
    agents: [{ agent_id: "planner", role: "planner", executor_ref: "dev.planner.v1" }, { agent_id: "builder", role: "builder", executor_ref: "dev.builder.v1" }],
    edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
  };
  const mission = missionFromExample(version, "a", { organization_id: "org_ds", project_id: "project_ds", team_id: "team_ds", team_version: "1", entry_agent_id: "planner" });
  assert.equal(mission.mission_id, "release-notes@v1:a");
  const result = await new OsaRuntime(createDevFixtureRegistry()).run(graph, mission);
  assert.equal(result.verdict, version.examples[0].expected!.verdict);
  assert.throws(() => missionFromExample(version, "nope", { organization_id: "o", project_id: "p", team_id: "t", team_version: "1", entry_agent_id: "planner" }), DatasetError);
});

test("HTTP: create, commit, tag, read by as_of, verify; errors map to 400/404/409", async () => {
  const server = createApiServer(new ExecutorRegistry(), new ApiState(createBuiltinIntelligence(CLOCK), new DatasetStore(CLOCK)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const json = { "content-type": "application/json" };
  try {
    let res = await fetch(`${base}/datasets`, { method: "POST", headers: json, body: JSON.stringify({ dataset_id: "api-ds", name: "API", examples: [example("a")] }) });
    assert.equal(res.status, 201);
    res = await fetch(`${base}/datasets/api-ds/versions`, { method: "POST", headers: json, body: JSON.stringify({ upsert: [example("b")], message: "add b" }) });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as DatasetVersion).version, 2);
    res = await fetch(`${base}/datasets/api-ds/tags/prod`, { method: "PUT", headers: json, body: JSON.stringify({ version: 1 }) });
    assert.equal(res.status, 200);
    res = await fetch(`${base}/datasets/api-ds?as_of=prod`);
    assert.equal(((await res.json()) as DatasetVersion).examples.length, 1);
    res = await fetch(`${base}/datasets/api-ds`);
    const latest = (await res.json()) as DatasetVersion;
    assert.equal(latest.version, 2);
    assert.ok(verifyDatasetVersion(latest).ok, "digests survive the JSON round trip");
    res = await fetch(`${base}/datasets/api-ds/verify?as_of=1`);
    assert.deepEqual(await res.json(), { ok: true, errors: [] });
    res = await fetch(`${base}/datasets/api-ds/versions`);
    assert.equal(((await res.json()) as unknown[]).length, 2);
    res = await fetch(`${base}/datasets`);
    assert.equal(((await res.json()) as unknown[]).length, 1);

    assert.equal((await fetch(`${base}/datasets/nope`)).status, 404);
    assert.equal((await fetch(`${base}/datasets/api-ds/versions`, { method: "POST", headers: json, body: JSON.stringify({ upsert: [example("b")] }) })).status, 409);
    assert.equal((await fetch(`${base}/datasets`, { method: "POST", headers: json, body: JSON.stringify({ dataset_id: "api-ds", name: "dup", examples: [example("a")] }) })).status, 409);
    assert.equal((await fetch(`${base}/datasets`, { method: "POST", headers: json, body: JSON.stringify({ dataset_id: "x", name: "X", examples: [example("a", "o", { requirements: [] })] }) })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
