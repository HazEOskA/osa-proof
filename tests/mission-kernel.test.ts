import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mission, TeamGraph } from "../packages/contracts/src";
import { digest, sealProofReceipt, verifyCompletedMission, verifyMissionExecution } from "../packages/proof-core/src";
import { ExecutorRegistry, FileMissionStore, MemoryMissionStore, MissionKernel, OsaRuntime } from "../packages/runtime/src";

const graph: TeamGraph = {
  organization_id: "tenant-a", project_id: "project-a", team_id: "team-a", version: "1",
  agents: [{ agent_id: "plan", role: "planner", executor_ref: "plan" }, { agent_id: "build", role: "builder", executor_ref: "build" }],
  edges: [{ edge_id: "handoff", from_agent_id: "plan", to_agent_id: "build", kind: "handoff" }],
};
const mission = (id = "mission-a"): Mission => ({
  organization_id: graph.organization_id, project_id: graph.project_id, mission_id: id,
  team_id: graph.team_id, team_version: graph.version, entry_agent_id: "plan", objective: "build an artifact",
  input: { request: "build" }, requirements: [{ requirement_id: "built", type: "evidence_field_equals", agent_id: "build", evidence_kind: "artifact", field: "status", expected: "built" }],
});
function registry(status = "built", onBuild = () => {}): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register("plan", ({ input }) => ({ output: input, evidence: [] }));
  registry.register("build", ({ input }) => { onBuild(); return { output: input, evidence: [{ kind: "artifact", data: { status } }] }; });
  return registry;
}

test("mission lifecycle comes from real runtime and completion seals the bound receipts", async () => {
  const kernel = new MissionKernel();
  const created = await kernel.create(mission(), graph);
  assert.equal(created.state, "CREATED");
  assert.deepEqual(created.task_graph.nodes[1].depends_on, [created.task_graph.nodes[0].task_id]);
  let builds = 0;
  const executors = registry("built", () => builds++);
  const run = await kernel.execute(created.mission.mission_id, executors);
  const completed = (await kernel.get(created.mission.mission_id))!;
  assert.equal(completed.state, "COMPLETED");
  verifyCompletedMission(completed);
  assert.deepEqual(completed.timeline.filter((e) => e.event_type.startsWith("MISSION_")).map((e) => e.event_type), ["MISSION_CREATED", "MISSION_PLANNED", "MISSION_EXECUTING", "MISSION_VERIFYING", "MISSION_COMPLETED"]);
  assert.ok(completed.timeline.every((e) => e.mission_id === mission().mission_id && e.tenant_id === graph.organization_id));
  assert.equal(completed.timeline.find((e) => e.event_type === "EVIDENCE_RECORDED")?.evidence[0], run.evidence[0].evidence_id);
  assert.equal((await kernel.execute(created.mission.mission_id, executors)).execution_id, run.execution_id);
  assert.equal(builds, 1);
  const modifiedTasks = structuredClone(completed);
  modifiedTasks.task_graph.nodes = [];
  const { receipt_sha256: _sha, ...receipt } = modifiedTasks.mission_receipt!;
  const forgedBody = { ...receipt, task_graph_sha256: digest(modifiedTasks.task_graph) };
  modifiedTasks.mission_receipt = { ...forgedBody, receipt_sha256: digest(forgedBody) };
  assert.throws(() => verifyCompletedMission(modifiedTasks), /MissionReceipt rejected/);
  completed.timeline[0].payload.tamper = true;
  assert.throws(() => verifyCompletedMission(completed), /MissionReceipt rejected/);
});

test("failure and missing evidence cannot complete a mission", async () => {
  for (const status of ["wrong", "missing"]) {
    const kernel = new MissionKernel();
    const executors = registry(status);
    if (status === "missing") executors.register("build", () => ({ output: {}, evidence: [] }));
    await kernel.create(mission(), graph);
    await kernel.execute(mission().mission_id, executors);
    const record = (await kernel.get(mission().mission_id))!;
    assert.equal(record.state, "FAILED");
    assert.equal(record.verification_receipt, undefined);
    assert.equal(record.mission_receipt, undefined);
    await assert.rejects(kernel.execute(mission().mission_id, executors), /illegal mission transition/);
  }
});

test("runtime failure overrides earlier satisfying evidence", async () => {
  const kernel = new MissionKernel();
  const input = mission(); input.requirements[0].agent_id = "plan";
  const executors = registry();
  executors.register("plan", () => ({ output: {}, evidence: [{ kind: "artifact", data: { status: "built" } }] }));
  executors.register("build", () => { throw new Error("crashed"); });
  await kernel.create(input, graph);
  assert.equal((await kernel.execute(input.mission_id, executors)).verdict, "FAILED");
  const record = (await kernel.get(input.mission_id))!;
  assert.equal(record.state, "FAILED");
  assert.equal(record.task_graph.nodes[1].state, "FAILED");
});

test("validation and policy reject work before any executor runs", async () => {
  const kernel = new MissionKernel();
  await assert.rejects(kernel.create({ ...mission(), organization_id: "other-tenant" }, graph), /tenant/);
  await assert.rejects(kernel.create({ ...mission(), budget: { max_tasks: 1 } }, graph), /budget/);
  await assert.rejects(kernel.create({ ...mission(), policy: { allowed_executor_refs: ["plan"] } }, graph), /denied/);
  const duplicate = mission(); duplicate.requirements.push(duplicate.requirements[0]);
  await assert.rejects(kernel.create(duplicate, graph), /requirement/);
  await assert.rejects(kernel.create(mission(), { ...graph, edges: [...graph.edges, { edge_id: "cycle", from_agent_id: "build", to_agent_id: "plan", kind: "handoff" }] }), /cycle/);
  assert.equal(await kernel.get(mission().mission_id), undefined);
});

test("receipt tampering, foreign tenant/mission and consistently resealed false verdict are rejected", async () => {
  const input = mission();
  const run = await new OsaRuntime(registry()).run(graph, input);
  verifyMissionExecution(graph, input, run);
  assert.throws(() => verifyMissionExecution(graph, { ...input, mission_id: "foreign" }, run), /rejected/);
  assert.throws(() => verifyMissionExecution({ ...graph, organization_id: "foreign" }, { ...input, organization_id: "foreign" }, run), /rejected/);
  const tampered = structuredClone(run); tampered.evidence[0].data.status = "wrong";
  assert.throws(() => verifyMissionExecution(graph, input, tampered), /rejected/);
  const failed = await new OsaRuntime(registry("wrong")).run(graph, input);
  const { proof_id, receipt_sha256, ...body } = failed.proof;
  failed.proof = sealProofReceipt({ ...body, verdict: "VERIFIED", requirement_verdicts: body.requirement_verdicts.map((r) => ({ ...r, verdict: "VERIFIED" })) });
  failed.verdict = "VERIFIED";
  assert.throws(() => verifyMissionExecution(graph, input, failed), /rejected/);
});

test("cancellation is terminal and active cancellation fails closed", async () => {
  const kernel = new MissionKernel();
  await kernel.create(mission(), graph);
  assert.equal((await kernel.cancel(mission().mission_id)).state, "CANCELLED");
  await assert.rejects(kernel.execute(mission().mission_id, registry()), /illegal/);
  await assert.rejects(kernel.cancel(mission().mission_id), /illegal/);
  const active = new MissionKernel(); await active.create(mission(), graph);
  const executors = registry();
  executors.register("build", async () => {
    await assert.rejects(active.cancel(mission().mission_id), /illegal/);
    return { output: {}, evidence: [{ kind: "artifact", data: { status: "built" } }] };
  });
  assert.equal((await active.execute(mission().mission_id, executors)).verdict, "VERIFIED");
});

test("optimistic concurrency prevents duplicate create and concurrent execution", async () => {
  const store = new MemoryMissionStore();
  const a = new MissionKernel(store), b = new MissionKernel(store);
  await a.create(mission(), graph);
  await assert.rejects(b.create(mission(), graph), /conflict/);
  let builds = 0;
  const outcomes = await Promise.allSettled([a.execute(mission().mission_id, registry("built", () => builds++)), b.execute(mission().mission_id, registry("built", () => builds++))]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(builds, 1);
});

test("filesystem snapshot survives restart and cannot silently change or traverse paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-mission-"));
  try {
    const input = mission("../../outside");
    const first = new MissionKernel(new FileMissionStore(directory));
    await first.create(input, graph);
    await first.execute(input.mission_id, registry());
    const second = new MissionKernel(new FileMissionStore(directory));
    const restored = (await second.get(input.mission_id))!;
    verifyCompletedMission(restored);
    let builds = 0;
    await second.execute(input.mission_id, registry("built", () => builds++));
    assert.equal(builds, 0);
    const files = await readdir(directory);
    assert.deepEqual(files, [`${digest(input.mission_id)}.json`]);
    const file = join(directory, files[0]);
    const envelope = JSON.parse(await readFile(file, "utf8"));
    envelope.record.state = "FAILED";
    await writeFile(file, JSON.stringify(envelope));
    await assert.rejects(second.get(input.mission_id), /integrity/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("separate file stores fence concurrent writers and stale revisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-mission-cas-"));
  try {
    const a = new FileMissionStore(directory), b = new FileMissionStore(directory);
    await new MissionKernel(a).create(mission(), graph);
    const original = (await a.get(mission().mission_id))!;
    const next = { ...original, revision: original.revision + 1 };
    const results = await Promise.allSettled([a.save(next, original.revision), b.save(next, original.revision)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    await assert.rejects(b.save(next, original.revision), /conflict/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restart refuses to re-execute an unresolved active mission", async () => {
  const store = new MemoryMissionStore();
  const kernel = new MissionKernel(store);
  const created = await kernel.create(mission(), graph);
  await store.save({ ...created, state: "EXECUTING", revision: created.revision + 1 }, created.revision);
  const restarted = new MissionKernel(store);
  let executions = 0;
  await assert.rejects(restarted.execute(mission().mission_id, registry("built", () => executions++)), /illegal/);
  assert.equal(executions, 0);
});
