export type RunVerdict = "VERIFIED" | "FAILED" | "INCOMPLETE";

export type EdgeKind = "handoff";

export interface AgentNode {
  agent_id: string;
  role: string;
  executor_ref: string;
  model_ref?: string;
  tool_capabilities?: string[];
  memory_ref?: string;
  policy_ref?: string;
}

export interface TeamEdge {
  edge_id: string;
  from_agent_id: string;
  to_agent_id: string;
  kind: EdgeKind;
}

export interface TeamGraph {
  organization_id: string;
  project_id: string;
  team_id: string;
  version: string;
  agents: AgentNode[];
  edges: TeamEdge[];
  policy_refs?: string[];
}

export interface EvidenceFieldEqualsRequirement {
  requirement_id: string;
  type: "evidence_field_equals";
  evidence_kind: string;
  field: string;
  expected: unknown;
  agent_id?: string;
}

export type AcceptanceRequirement = EvidenceFieldEqualsRequirement;

export interface Mission {
  organization_id: string;
  project_id: string;
  mission_id: string;
  team_id: string;
  team_version: string;
  objective: string;
  entry_agent_id: string;
  input: unknown;
  requirements: AcceptanceRequirement[];
  attempt?: number;
}

export type RuntimeEventType =
  | "RUN_CREATED"
  | "RUN_STARTED"
  | "AGENT_STARTED"
  | "AGENT_COMPLETED"
  | "AGENT_FAILED"
  | "HANDOFF_CREATED"
  | "EVIDENCE_RECORDED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"
  | "RUN_VERIFIED"
  | "RUN_FAILED"
  | "RUN_INCOMPLETE";

export interface RuntimeEvent {
  event_id: string;
  run_id: string;
  sequence: number;
  type: RuntimeEventType;
  organization_id: string;
  project_id: string;
  team_id: string;
  team_version: string;
  mission_id: string;
  agent_id?: string;
  payload: Record<string, unknown>;
}

export interface EvidenceInput {
  kind: string;
  data: Record<string, unknown>;
}

export interface EvidenceRecord extends EvidenceInput {
  evidence_id: string;
  run_id: string;
  sequence: number;
  organization_id: string;
  project_id: string;
  team_id: string;
  team_version: string;
  mission_id: string;
  agent_id: string;
}

export interface RequirementVerdict {
  requirement_id: string;
  verdict: RunVerdict;
  evidence_ids: string[];
  reason: string;
}

export interface ProofReceipt {
  proof_id: string;
  run_id: string;
  organization_id: string;
  project_id: string;
  team_id: string;
  team_version: string;
  mission_id: string;
  verdict: RunVerdict;
  requirement_verdicts: RequirementVerdict[];
  evidence_ids: string[];
  verifier: {
    name: "osa-proof-deterministic-v1";
    version: "1";
  };
}

export interface AgentExecutionContext {
  run_id: string;
  mission: Mission;
  agent: AgentNode;
  input: unknown;
}

export interface AgentExecutionResult {
  output: unknown;
  evidence: EvidenceInput[];
}

export type AgentExecutor = (
  context: AgentExecutionContext
) => Promise<AgentExecutionResult> | AgentExecutionResult;

export interface RunResult {
  run_id: string;
  verdict: RunVerdict;
  final_output: unknown;
  events: RuntimeEvent[];
  evidence: EvidenceRecord[];
  proof: ProofReceipt;
}

export type OsaLayerId =
  | "school"
  | "dev"
  | "bank"
  | "financial"
  | "cybersecurity"
  | "army";

export type OsaProductLayer = "ACADEMY" | "BUILDER" | "REGULATED";

export type IdentityProvider = "local-dev" | "github" | "google" | "microsoft";

export interface Identity {
  identity_id: string;
  provider: IdentityProvider;
  subject: string;
  display_name: string;
  email?: string;
  organization_id?: string;
  roles: string[];
  verified: boolean;
}

export interface SessionRecord {
  session_id: string;
  token: string;
  identity: Identity;
  created_at: string;
  expires_at: string;
}

export type LayerAccessMode = "PUBLIC" | "AUTHENTICATED" | "REGULATED";
export type LayerEntryDecision = "ALLOWED" | "GATED";

export interface LayerProfile {
  layer_id: OsaLayerId;
  label: string;
  product_layer: OsaProductLayer;
  access_mode: LayerAccessMode;
  route: string;
  proof_required: boolean;
  requirements: string[];
}

export interface LayerAccessGate {
  code: "AUTHENTICATED_SESSION_REQUIRED" | "VERIFIED_ORGANIZATION_REQUIRED";
  requirements: string[];
  authoritative: true;
}

export interface LayerEnterResult {
  decision: LayerEntryDecision;
  layer: LayerProfile;
  gate?: LayerAccessGate;
}
