// Mirrors the contracts in HazEOskA/osa-proof (packages/contracts/src/index.ts). Only fields the UI reads.
export type Verdict = "VERIFIED" | "FAILED" | "INCOMPLETE";
export interface Binding { organization_id: string; project_id: string; team_id: string; team_version: string; mission_id: string; run_id: string; execution_id: string }
export interface AgentNode { agent_id: string; role: string; executor_ref: string; model_ref?: string; tool_capabilities?: string[]; memory_ref?: string; policy_ref?: string }
export interface TeamGraph { organization_id: string; project_id: string; team_id: string; version: string; agents: AgentNode[]; edges: { edge_id: string; from_agent_id: string; to_agent_id: string; kind: string }[] }
export interface Requirement { requirement_id: string; type: string; evidence_kind: string; field: string; expected: unknown; agent_id?: string }
export interface Mission { organization_id: string; project_id: string; mission_id: string; team_id: string; team_version: string; objective: string; entry_agent_id: string; input: unknown; requirements: Requirement[] }
export interface RuntimeEvent { event_id: string; run_id: string; execution_id?: string; sequence: number; type: string; agent_id?: string; mission_id: string; payload: Record<string, unknown> }
export interface EvidenceRecord { evidence_id: string; run_id: string; execution_id: string; sequence: number; agent_id: string; binding: Binding; producer: { type: string; agent_id: string; executor_ref: string; operation_id: string }; kind: string; data: Record<string, unknown>; content_sha256?: string; content_bytes?: number; evidence_sha256: string; provenance: string }
export interface Observation { observation_id: string; sequence: number; evidence_id: string; check: string; ok: boolean; reason: string; observation_sha256: string; producer: { name: string; version: string } }
export interface RequirementVerdict { requirement_id: string; verdict: Verdict; evidence_ids: string[]; reason: string }
export interface ProofReceipt {
  schema: string; proof_id: string; receipt_sha256: string; run_id: string; execution_id: string; mission_id: string; team_id: string; team_version: string;
  binding: Binding; verdict: Verdict; requirement_verdicts: RequirementVerdict[]; runtime_failure?: string;
  evidence_ids: string[]; evidence_refs: { evidence_id: string; evidence_sha256: string }[]; evidence_root: string;
  observation_refs: { observation_id: string; observation_sha256: string }[]; final_output_sha256: string | null; created_at: string;
  verifier: { name: string; version: string };
  [k: string]: unknown;
}
export interface Run { run_id: string; execution_id: string; verdict: Verdict; final_output: unknown; events: RuntimeEvent[]; evidence: EvidenceRecord[]; observations: Observation[]; proof: ProofReceipt }
export interface LayerProfile { layer_id: string; label: string; product_layer: string; access_mode: string; route: string; proof_required: boolean; requirements: string[] }
export interface Snapshot {
  captured_at: string;
  source: { api: string; mode: string; repo: string; commit: string | null };
  layers: LayerProfile[]; team: TeamGraph; missions: Mission[]; runs: Run[];
  repo: { packages: string[]; apps: string[]; docs: string[] };
}
export type Source = { kind: "LIVE" | "SNAPSHOT"; detail: string };
