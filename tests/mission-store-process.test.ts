import assert from "node:assert/strict";
import test from "node:test";
import { fork, execFile, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mission, TeamGraph } from "../packages/contracts/src";
import { ExecutorRegistry, FileMissionStore, MissionKernel } from "../packages/runtime/src";
import { digest, verifyCompletedMission } from "../packages/proof-core/src";

const graph: TeamGraph = { organization_id: "process-org", project_id: "process-project", team_id: "process-team", version: "1",
  agents: [{ agent_id: "reader", role: "reader", executor_ref: "reader" }], edges: [] };
const mission = (id: string): Mission => ({ organization_id: graph.organization_id, project_id: graph.project_id, team_id: graph.team_id,
  team_version: graph.version, mission_id: id, entry_agent_id: "reader", objective: "synthetic test", input: {},
  policy: { allowed_executor_refs: ["reader"] }, requirements: [{ requirement_id: "read", type: "evidence_field_equals", evidence_kind: "read", field: "ok", expected: true }] });
const execFileAsync = promisify(execFile);
async function inspect(directory: string, id: string) {
  const result = await execFileAsync(process.execPath, [join(process.cwd(), "scripts/inspect-mission-store.cjs"), directory, id]);
  return JSON.parse(result.stdout) as { assessment: string; lock_present: boolean; state: string | null };
}
const worker = () => fork(join(process.cwd(), "scripts/final-boss-store-worker.cjs"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
function message(child: ChildProcess, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`child timed out waiting for ${type}`)); }, 10000);
    const onMessage = (value: any) => { if (type === "result" ? ["done", "rejected"].includes(value?.type) : value?.type === type) { cleanup(); resolve(value); } };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => { cleanup(); reject(new Error(`child exited before ${type}: ${code ?? signal}`)); };
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
    child.on("message", onMessage); child.once("exit", onExit);
  });
}

test("separate processes sharing FileMissionStore perform one side effect under concurrent retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-store-process-"));
  const children = [worker(), worker()];
  try {
    const id = "process-race", log = join(directory, "effects.log");
    await new MissionKernel(new FileMissionStore(directory)).create(mission(id), graph);
    await Promise.all(children.map(child => message(child, "ready")));
    const results = children.map(child => message(child, "result"));
    for (const child of children) child.send({ directory, missionId: id, log });
    const outcomes = await Promise.all(results);
    assert.ok(outcomes.some(result => result.type === "done" && result.verdict === "VERIFIED"), JSON.stringify(outcomes));
    assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
    const record = await new FileMissionStore(directory).get(id); assert.ok(record); verifyCompletedMission(record);
    assert.equal((await inspect(directory, id)).assessment, "COMPLETED_INTEGRITY_CHECKED");
    const lock = join(directory, `${digest(id)}.json.lock`); await writeFile(lock, "synthetic lock");
    assert.equal((await inspect(directory, id)).assessment, "LOCK_PRESENT_MANUAL_REVIEW");
    await assert.rejects(new FileMissionStore(directory).save({ ...record, revision: record.revision + 1 }, record.revision), /mission is locked/);
    assert.equal(await readFile(lock, "utf8"), "synthetic lock");
  } finally { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); await rm(directory, { recursive: true, force: true }); }
});

test("restart after a worker process dies following a side effect fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-store-crash-"));
  const child = worker();
  try {
    const id = "process-crash", log = join(directory, "effects.log");
    await new MissionKernel(new FileMissionStore(directory)).create(mission(id), graph);
    await message(child, "ready"); const effect = message(child, "effect");
    child.send({ directory, missionId: id, log, hold: true }); await effect;
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
    const restarted = new MissionKernel(new FileMissionStore(directory));
    assert.equal((await restarted.get(id))?.state, "EXECUTING");
    assert.equal((await inspect(directory, id)).assessment, "ACTIVE_REQUIRES_RECONCILIATION");
    let repeated = 0; const registry = new ExecutorRegistry(); registry.register("reader", () => { repeated++; return { output: {}, evidence: [] }; });
    await assert.rejects(restarted.execute(id, registry), /illegal mission transition/);
    assert.equal(repeated, 0); assert.equal((await readFile(log, "utf8")).trim(), "effect");
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await rm(directory, { recursive: true, force: true }); }
});
