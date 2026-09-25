import { EvidenceInput, EvidenceRecord, Mission, TeamGraph } from "../../contracts/src";

export class EvidenceCollector {
  private readonly byRun = new Map<string, EvidenceRecord[]>();

  record(params: {
    run_id: string;
    graph: TeamGraph;
    mission: Mission;
    agent_id: string;
    evidence: EvidenceInput;
  }): EvidenceRecord {
    const current = this.byRun.get(params.run_id) ?? [];
    const sequence = current.length + 1;
    const record: EvidenceRecord = {
      evidence_id: `${params.run_id}:evidence:${sequence}`,
      run_id: params.run_id,
      sequence,
      organization_id: params.graph.organization_id,
      project_id: params.graph.project_id,
      team_id: params.graph.team_id,
      team_version: params.graph.version,
      mission_id: params.mission.mission_id,
      agent_id: params.agent_id,
      kind: params.evidence.kind,
      data: structuredClone(params.evidence.data),
    };
    current.push(record);
    this.byRun.set(params.run_id, current);
    return structuredClone(record);
  }

  list(runId: string): EvidenceRecord[] {
    return (this.byRun.get(runId) ?? []).map((record) => structuredClone(record));
  }
}
