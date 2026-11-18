import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { ExecutorRegistry, MemoryMissionStore, MissionKernel } from "../packages/runtime/src";
import type { Mission, TeamGraph } from "../packages/contracts/src";

const graph = (org: string, project: string): TeamGraph => ({ organization_id:org, project_id:project,
  team_id:`team-${project}`, version:"1", agents:[{agent_id:"agent",role:"executor",executor_ref:"test.executor"}], edges:[] });
const mission = (team: TeamGraph, id: string, objective = "test"): Mission => ({ organization_id:team.organization_id,
  project_id:team.project_id, mission_id:id, team_id:team.team_id, team_version:team.version,
  objective, entry_agent_id:"agent", input:{}, requirements:[{requirement_id:"result",type:"evidence_field_equals",evidence_kind:"result",field:"ok",expected:true}] });

test("scoped mission list merges the two existing stores, denies other tenants and fails closed on collisions", async () => {
  const primary = new MemoryMissionStore(), secondary = new MemoryMissionStore();
  const kernel = new MissionKernel(primary), durable = new MissionKernel(secondary);
  const a = graph("org-a", "project-a"), b = graph("org-a", "project-b"), c = graph("org-b", "project-c");
  await kernel.create(mission(a,"mission-api"),a);
  await durable.create(mission(a,"mission-durable"),a);
  await durable.create(mission(b,"mission-other-project"),b);
  await kernel.create(mission(c,"mission-other-org"),c);
  const state = new ApiState(undefined,undefined,undefined,"session",primary,undefined,undefined,undefined,secondary);
  const session = state.sessions.create({identity_id:"test",provider:"microsoft",subject:"test",display_name:"test",
    verified:true,roles:[],organization_id:"org-a",project_ids:["project-a"]});
  const server = createApiServer(new ExecutorRegistry(),state);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = {authorization:`Bearer ${session.token}`};
  try {
    assert.equal((await fetch(`${base}/missions`)).status,401);
    const response = await fetch(`${base}/missions`,{headers});
    assert.equal(response.status,200);
    const records = await response.json() as Array<{mission:Mission;storage_source:string}>;
    assert.deepEqual(records.map(item=>[item.mission.mission_id,item.storage_source]).sort(), [["mission-api","API"],["mission-durable","DURABLE"]]);
    assert.equal((await fetch(`${base}/missions/mission-durable`,{headers})).status,200);
    assert.equal((await fetch(`${base}/missions/mission-other-project`,{headers})).status,403);
    assert.equal((await fetch(`${base}/missions/mission-durable/run`,{method:"POST",headers})).status,409);
    const inconsistent = (await primary.get("mission-api"))!;
    inconsistent.team.project_id = "project-b";
    inconsistent.revision++;
    await primary.save(inconsistent, inconsistent.revision - 1);
    assert.equal((await fetch(`${base}/missions`,{headers})).status,409);
    assert.equal((await fetch(`${base}/missions/mission-api`,{headers})).status,409);
    inconsistent.team.project_id = "project-a";
    inconsistent.revision++;
    await primary.save(inconsistent, inconsistent.revision - 1);
    inconsistent.verification_receipt = {binding:{organization_id:"org-a",project_id:"project-b"}} as never;
    inconsistent.revision++;
    await primary.save(inconsistent, inconsistent.revision - 1);
    assert.equal((await fetch(`${base}/missions`,{headers})).status,409);
    assert.equal((await fetch(`${base}/missions/mission-api`,{headers})).status,409);
    delete inconsistent.verification_receipt;
    inconsistent.revision++;
    await primary.save(inconsistent, inconsistent.revision - 1);
    await durable.create(mission(a,"mission-api","conflicting record"),a);
    assert.equal((await fetch(`${base}/missions`,{headers})).status,409);
    assert.equal((await fetch(`${base}/missions/mission-api`,{headers})).status,409);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
