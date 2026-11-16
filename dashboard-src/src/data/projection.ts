import type { Mission, Run, TeamGraph } from "./types";

export type MissionRecordView = { mission: Mission; team: TeamGraph; state: string; run?: Run };
export type InspectedExecution = { identity_id: string; team: TeamGraph; mission: Mission; run: Run };

/** Keep the explicitly inspected API execution visible alongside the live MissionStore listing. */
export function projectMissionRecords(records: MissionRecordView[], pinned: InspectedExecution | null, identityId: string | null) {
  const missions=records.map(record=>record.mission);
  const runs=records.flatMap(record=>record.run?[record.run]:[]);
  const teams=records.map(record=>record.team);
  const missionStates=Object.fromEntries(records.map(record=>[record.mission.mission_id,record.state]));
  if(pinned&&pinned.identity_id===identityId) {
    if(!missions.some(mission=>mission.mission_id===pinned.mission.mission_id))missions.push(pinned.mission);
    if(!runs.some(run=>run.run_id===pinned.run.run_id))runs.unshift(pinned.run);
    if(!teams.some(team=>team.team_id===pinned.team.team_id&&team.version===pinned.team.version))teams.unshift(pinned.team);
  }
  return {missions,runs,teams,missionStates};
}
