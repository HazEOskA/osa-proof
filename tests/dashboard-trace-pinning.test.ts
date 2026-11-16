import assert from "node:assert/strict";
import test from "node:test";
import { projectMissionRecords, type InspectedExecution, type MissionRecordView } from "../dashboard-src/src/data/projection";
import type { Mission, Run, TeamGraph } from "../dashboard-src/src/data/types";

const mission=(id:string)=>({mission_id:id,organization_id:"org",project_id:"project",team_id:"team",team_version:"1",
  objective:id,entry_agent_id:"agent",input:{},requirements:[]} as Mission);
const team={organization_id:"org",project_id:"project",team_id:"team",version:"1",agents:[],edges:[]} as TeamGraph;
const run=(id:string)=>({run_id:id,execution_id:id,verdict:"VERIFIED",final_output:{},events:[],evidence:[],observations:[],proof:{}} as unknown as Run);

test("dashboard refresh keeps inspected trace execution alongside current MissionStore records",()=>{
  const pinned:InspectedExecution={identity_id:"identity-a",team,mission:mission("osa-trace-1"),run:run("exec-trace-1")};
  const live:MissionRecordView[]=[{mission:mission("stored-mission"),team,state:"COMPLETED",run:run("exec-stored")}];
  const projection=projectMissionRecords(live,pinned,"identity-a");
  assert.deepEqual(projection.missions.map(item=>item.mission_id),["stored-mission","osa-trace-1"]);
  assert.deepEqual(projection.runs.map(item=>item.run_id),["exec-trace-1","exec-stored"]);
  assert.equal(projection.missionStates["stored-mission"],"COMPLETED");
});

test("dashboard pin merges an already-persisted execution without duplicate rows",()=>{
  const pinned:InspectedExecution={identity_id:"identity-a",team,mission:mission("mission"),run:run("execution")};
  const projection=projectMissionRecords([{mission:pinned.mission,team,state:"COMPLETED",run:pinned.run}],pinned,"identity-a");
  assert.equal(projection.missions.length,1);
  assert.equal(projection.runs.length,1);
  assert.equal(projection.teams.length,1);
});

test("dashboard refresh discards inspected trace after account identity changes",()=>{
  const pinned:InspectedExecution={identity_id:"identity-a",team,mission:mission("osa-trace-1"),run:run("exec-trace-1")};
  const projection=projectMissionRecords([],pinned,"identity-b");
  assert.deepEqual(projection.missions,[]);
  assert.deepEqual(projection.runs,[]);
  assert.deepEqual(projection.teams,[]);
});
