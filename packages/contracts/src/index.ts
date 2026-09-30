export type RunVerdict = "VERIFIED" | "FAILED" | "INCOMPLETE";

export type EdgeKind = "handoff";

export interface AgentNode {
  // Optional UI asset reference; it does not alter the execution role.
  avatar_ref?: string;
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
  // Absent only on events persisted before proof receipt v2.
  execution_id?: string;
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

export type EvidenceProvenance = "EXECUTOR_EVIDENCE" | "VERIFIER_OBSERVATION";

// Identifies exactly one execution of one mission against one Team Graph version.
// run_id is deterministic per mission attempt; execution_id is unique per runtime.run().
export interface ExecutionBinding {
  organization_id: string;
  project_id: string;
  team_id: string;
  team_version: string;
  mission_id: string;
  run_id: string;
  execution_id: string;
}

export interface ExecutorProducer {
  type: "executor";
  agent_id: string;
  executor_ref: string;
  operation_id: string;
}

export interface VerifierProducer {
  type: "verifier";
  name: string;
  version: string;
}

export interface EvidenceInput {
  kind: string;
  data: Record<string, unknown>;
  // Raw artifact content. Core hashes it (content_sha256, content_bytes) and does not store it.
  content?: string;
}

export interface EvidenceRecord {
  evidence_id: string;
  run_id: string;
  execution_id: string;
  sequence: number;
  organization_id: string;
  project_id: string;
  team_id: string;
  team_version: string;
  mission_id: string;
  agent_id: string;
  provenance: "EXECUTOR_EVIDENCE";
  binding: ExecutionBinding;
  producer: ExecutorProducer;
  kind: string;
  data: Record<string, unknown>;
  content_sha256?: string;
  content_bytes?: number;
  // Computed by core over the canonical record (all fields except this one).
  evidence_sha256: string;
}

export type ObservationCheck = "binding" | "evidence_digest" | "content_digest";

// Produced by the verifier, never by an executor. Same process as the runtime:
// it separates provenance, it does not establish external trust by itself.
export interface VerifierObservation {
  observation_id: string;
  sequence: number;
  provenance: "VERIFIER_OBSERVATION";
  binding: ExecutionBinding;
  producer: VerifierProducer;
  evidence_id: string;
  check: ObservationCheck;
  ok: boolean;
  expected?: unknown;
  observed?: unknown;
  reason: string;
  observation_sha256: string;
}

export interface RequirementVerdict {
  requirement_id: string;
  verdict: RunVerdict;
  evidence_ids: string[];
  reason: string;
}

export interface EvidenceRef {
  evidence_id: string;
  evidence_sha256: string;
}

export interface ObservationRef {
  observation_id: string;
  observation_sha256: string;
}

export interface ProofReceipt {
  schema: "osa.proof_receipt.v2";
  // "proof_" + receipt_sha256; derived only after the final verdict is known.
  proof_id: string;
  // sha256 of the canonical receipt without proof_id and receipt_sha256.
  receipt_sha256: string;
  run_id: string;
  execution_id: string;
  organization_id: string;
  project_id: string;
  team_id: string;
  team_version: string;
  mission_id: string;
  binding: ExecutionBinding;
  verdict: RunVerdict;
  requirement_verdicts: RequirementVerdict[];
  runtime_failure?: string;
  evidence_ids: string[];
  evidence_refs: EvidenceRef[];
  evidence_root: string;
  observation_refs: ObservationRef[];
  final_output_sha256: string | null;
  created_at: string;
  verifier: {
    name: "osa-proof-deterministic";
    version: "2";
  };
}

export interface AgentExecutionContext {
  run_id: string;
  execution_id: string;
  operation_id: string;
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
  execution_id: string;
  verdict: RunVerdict;
  final_output: unknown;
  events: RuntimeEvent[];
  evidence: EvidenceRecord[];
  observations: VerifierObservation[];
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
export type LayerAccessMode = "PUBLIC" | "REGULATED";
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
  code: "VERIFIED_ORGANIZATION_REQUIRED";
  requirements: string[];
  authoritative: true;
}

export interface LayerEnterResult {
  decision: LayerEntryDecision;
  layer: LayerProfile;
  gate?: LayerAccessGate;
}

