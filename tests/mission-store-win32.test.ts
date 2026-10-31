import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mission, TeamGraph } from "../packages/contracts/src";
import { digest } from "../packages/proof-core/src";
import { FileMissionStore, MissionKernel, syncMissionDirectory } from "../packages/runtime/src";

const graph: TeamGraph = {
  organization_id: "org_win32", project_id: "project_win32", team_id: "team_win32", version: "1",
  agents: [{ agent_id: "worker", role: "worker", executor_ref: "worker" }], edges: [],
};
const mission: Mission = {
  organization_id: graph.organization_id, project_id: graph.project_id,
  team_id: graph.team_id, team_version: graph.version, mission_id: "win32-sync-regression",
  entry_agent_id: "worker", objective: "Verify durable local mission storage",
  input: {}, requirements: [{
    requirement_id: "complete", type: "evidence_field_equals",
    evidence_kind: "artifact", field: "status", expected: "built",
  }],
};

test("Win32 directory sync skip is narrow; POSIX path still propagates filesystem errors", async () => {
  const missing = join(tmpdir(), "osa-nonexistent-dir-" + process.pid + "-" + Date.now());
  // This must not attempt to open/fsync a directory (which fails on Windows).
  await assert.doesNotReject(syncMissionDirectory(missing, "win32"));
  // Non-Windows path must not swallow an ENOENT or an fsync failure.
  await assert.rejects(syncMissionDirectory(missing, "linux"),
    (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT");
});

test("native FileMissionStore saves and reloads a hashed snapshot without leftover lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-win32-fsync-"));
  try {
    const store = new FileMissionStore(directory);
    const kernel = new MissionKernel(store);
    const created = await kernel.create(mission, graph);
    const restored = await new FileMissionStore(directory).get(mission.mission_id);
    assert.ok(restored, "snapshot must survive a fresh FileMissionStore instance");
    assert.equal(restored.revision, created.revision);
    assert.equal(restored.state, "CREATED");
    assert.equal(digest(restored), digest(created));
    const filename = digest(mission.mission_id) + ".json";
    assert.deepEqual(await readdir(directory), [filename], "no stale lock or temporary file");
    const envelope = JSON.parse(await readFile(join(directory,filename), "utf8")) as {
      record: unknown; sha256: string;
    };
    assert.equal(envelope.sha256, digest(envelope.record), "stored snapshot hash must match bytes");
  } finally {
    await rm(directory, {recursive:true,force:true});
  }
});
