const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  module._compile(output, filename);
};
const { buildGraph, causalPath } = require(path.join(__dirname, "../src/lib/graph.ts"));
const { pendingMissions, worldRuns, MAX_WORLD_RUNS } = require(path.join(__dirname, "../src/data/projection.ts"));
const makeTeam = (teamId) => ({ organization_id: "org-1", project_id: "project-1", team_id: teamId, version: "1", agents: [{ agent_id: "shared-agent", role: teamId, executor_ref: "exec-" + teamId, model_ref: "free-model" }], edges: [] });
const makeMission = (teamId, missionId) => ({ organization_id: "org-1", project_id: "project-1", mission_id: missionId, team_id: teamId, team_version: "1", objective: missionId, entry_agent_id: "shared-agent", input: {}, requirements: [] });
const makeRun = (teamId, missionId, runId) => ({
  run_id: runId, execution_id: "execution-" + runId, verdict: "VERIFIED", final_output: "ok", events: [], observations: [],
  proof: { schema: "proof/v1", proof_id: "proof-" + runId, receipt_sha256: "receipt", run_id: runId, execution_id: "execution-" + runId, mission_id: missionId, team_id: teamId, team_version: "1", binding: { organization_id: "org-1", project_id: "project-1", team_id: teamId, team_version: "1", mission_id: missionId, run_id: runId, execution_id: "execution-" + runId }, verdict: "VERIFIED", requirement_verdicts: [], evidence_ids: ["evidence-" + runId], evidence_refs: [], evidence_root: "root", observation_refs: [], final_output_sha256: "output", created_at: "2026-01-01T00:00:00Z", verifier: { name: "test", version: "1" } },
  evidence: [{ evidence_id: "evidence-" + runId, run_id: runId, execution_id: "execution-" + runId, sequence: 1, agent_id: "shared-agent", binding: { organization_id: "org-1", project_id: "project-1", team_id: teamId, team_version: "1", mission_id: missionId, run_id: runId, execution_id: "execution-" + runId }, producer: { type: "agent", agent_id: "shared-agent", executor_ref: "exec-" + teamId, operation_id: "op-" + runId }, kind: "output", data: { status: "verified" }, evidence_sha256: "sha-" + runId, provenance: "test fixture" }],
});
const teamA = makeTeam("team-a"), teamB = makeTeam("team-b");
const snapshot = { captured_at: "2026-01-01T00:00:00Z", source: { api: "fixture", mode: "TEST", repo: "osa-proof", commit: null }, layers: [], team: teamA, teams: [teamA, teamB], missions: [makeMission("team-a", "mission-a"), makeMission("team-b", "mission-b")], runs: [makeRun("team-a", "mission-a", "run-a"), makeRun("team-b", "mission-b", "run-b")], repo: { packages: [], apps: [], docs: [] } };
test("World graph retains both team scopes and links each run to its own agents", () => {
  const graph = buildGraph(snapshot);
  const teamNodes = graph.nodes.filter(node => node.type === "WORKSPACE" && node.detail.kind === "Team Graph (source of truth)");
  const agentNodes = graph.nodes.filter(node => node.type === "AGENT" && node.detail.identity === "shared-agent");
  assert.equal(teamNodes.length, 2); assert.equal(agentNodes.length, 2); assert.notEqual(agentNodes[0].id, agentNodes[1].id);
  assert.equal(graph.edges.some(edge => !graph.byId.has(edge.from) || !graph.byId.has(edge.to)), false);
  assert.equal(graph.edges.some(edge => edge.from === "team" && edge.to === "mission:mission-a"), true);
  assert.equal(graph.edges.some(edge => edge.from.startsWith("team:") && edge.to === "mission:mission-b"), true);
});
test("causal paths are scoped to the selected run and tolerate an absent endpoint", () => {
  const graph = buildGraph(snapshot), pathA = causalPath(graph, "run-a"), pathB = causalPath(graph, "run-b");
  assert.equal(pathA.nodes.has("evidence:evidence-run-a"), true); assert.equal(pathA.nodes.has("evidence:evidence-run-b"), false);
  assert.equal(pathB.nodes.has("evidence:evidence-run-b"), true); assert.equal(pathB.nodes.has("evidence:evidence-run-a"), false);
  const damaged = { ...graph, edges: [...graph.edges, { id: "missing", from: "mission:mission-b", to: "agent:missing", kind: "entry" }] };
  assert.doesNotThrow(() => causalPath(damaged, "run-b"));
});
test("Missions shows pending records even when another mission already has a verified run", () => {
  const pending = pendingMissions({...snapshot, missions:[...snapshot.missions,makeMission("team-a","mission-not-yet-executed")]});
  assert.deepEqual(pending.map(m=>m.mission_id),["mission-not-yet-executed"]);
});
test("Home solar preview retains a real sun node without running expensive history layout", () => {
  const home=buildGraph({...snapshot,runs:[]});
  assert.ok(home.nodes.length>0);
  assert.ok(home.byId.has("team"));
  assert.equal(home.nodes.some(n=>n.type==="MISSION"),false);
});
test("World graph caps history without losing full MissionStore run listing", () => {
  const allRuns=Array.from({length:MAX_WORLD_RUNS+12},(_,i)=>makeRun("team-a","mission-a","run-"+i));
  assert.equal(worldRuns(allRuns).length,MAX_WORLD_RUNS);
  assert.equal(worldRuns(allRuns)[0].run_id,allRuns[0].run_id);
  assert.equal(allRuns.length,MAX_WORLD_RUNS+12);
});
test("single-team graph keeps its existing team and agent identifiers", () => {
  const singleTeam = { ...snapshot, teams: [teamA], runs: [snapshot.runs[0]], missions: [snapshot.missions[0]] }, graph = buildGraph(singleTeam);
  assert.ok(graph.byId.has("team")); assert.ok(graph.byId.has("agent:shared-agent")); assert.ok(graph.byId.has("mission:mission-a"));
});
