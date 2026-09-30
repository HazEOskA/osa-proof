import type { Mission, TaskGraph, TeamGraph } from "./index";

export interface BrainScope { organization_id: string; project_id: string; mission_id: string }
export interface BrainWorldState {
  mission_state: "CREATED";
  team_version: string;
  task_states: Array<{ task_id: string; state: "PENDING" }>;
}
export interface BrainMemoryContext {
  scope: BrainScope;
  brain_id: string;
  ledger_head: string;
  text: string;
  references: unknown[];
  truncated: boolean;
  context_sha256: string;
}
export interface BrainPlanRequest {
  mission: Mission;
  team: TeamGraph;
  task_graph: TaskGraph;
  world_state: BrainWorldState;
  memory?: BrainMemoryContext;
}
// Proposal cannot grant capabilities, change requirements, select credentials or
// rewrite the canonical TeamGraph. Those decisions remain below the model.
export interface BrainPlanProposal {
  summary: string;
  goals: string[];
  tasks: Array<{ task_id: string; agent_id: string; instruction: string }>;
}
export interface BrainPlanner {
  readonly id: string;
  readonly mode: "native" | "model";
  readonly model_refs: readonly string[];
  propose(request: BrainPlanRequest): Promise<{ proposal: unknown; evidence: Record<string, unknown> }>;
}
export interface BrainMemory {
  readonly id: string;
  recall(scope: BrainScope, objective: string, maxChars: number): Promise<BrainMemoryContext>;
}
export interface MissionPlan {
  schema: "osa.mission_plan.v1";
  scope: BrainScope;
  mission_sha256: string;
  team_sha256: string;
  summary: string;
  goals: string[];
  tasks: Array<{
    task_id: string; agent_id: string; instruction: string; depends_on: string[];
    executor_ref: string; model_ref?: string; framework_ref: "osa.native";
  }>;
  risk: "UNASSESSED";
  plan_sha256: string;
}
export interface DecisionReceipt {
  schema: "osa.decision_receipt.v1";
  scope: BrainScope;
  task_id: string;
  selection: { agent_id: string; executor_ref: string; model_ref?: string; framework_ref: "osa.native"; declared_tool_capabilities: string[] };
  reason: "PINNED_TEAM_GRAPH";
  policy_sha256: string;
  budget_sha256: string;
  receipt_sha256: string;
}
export interface PlanningReceipt {
  schema: "osa.planning_receipt.v1";
  scope: BrainScope;
  planner_id: string;
  mode: "native" | "model";
  model_refs: string[];
  mission_sha256: string;
  team_sha256: string;
  plan_sha256: string;
  proposal_sha256: string;
  world_state_sha256: string;
  memory_context_sha256: string | null;
  decisions_root: string;
  evidence: Record<string, unknown>;
  created_at: string;
  verdict: "ACCEPTED";
  receipt_sha256: string;
}
export interface BrainReflection {
  schema: "osa.brain_reflection.v1";
  scope: BrainScope;
  execution_id: string;
  proof_receipt_sha256: string;
  verdict: "VERIFIED" | "FAILED" | "INCOMPLETE";
  failed_requirements: string[];
  recovery: "NONE" | "REVIEW_REQUIRED";
  reflection_sha256: string;
}
export interface BrainPlanResult {
  plan: MissionPlan;
  planning_receipt: PlanningReceipt;
  decision_receipts: DecisionReceipt[];
  world_state: BrainWorldState;
  memory?: BrainMemoryContext;
  reflection?: BrainReflection;
}
