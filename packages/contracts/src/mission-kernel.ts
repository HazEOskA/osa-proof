import type { Mission, ProofReceipt, RunResult, TeamGraph } from "./index";

export type MissionState = "CREATED" | "PLANNED" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type TaskState = "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED";
// Limits S1 can actually enforce before execution. Monetary/resource budgets
// belong to the metered execution plane and must not be implied by these fields.
export interface MissionPolicy { allowed_executor_refs: string[]; allowed_model_refs?: string[]; required_receipts?: Array<"sandbox_receipt" | "build_receipt" | "image_receipt" | "deployment_receipt" | "live_verification_receipt"> }
export interface MissionBudget { max_tasks: number; max_context_chars?: number }
export interface TaskNode { task_id: string; mission_id: string; agent_id: string; depends_on: string[]; state: TaskState }
export interface TaskGraph { mission_id: string; nodes: TaskNode[] }
// S1 uses the existing receipt contract; it does not assert external/live verification.
export type VerificationReceipt = ProofReceipt;
export interface OSAEvent {
  event_id: string;
  event_type: string;
  mission_id: string;
  tenant_id: string;
  source: string;
  subject: string;
  timestamp: string;
  causation_id?: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  evidence: string[];
}
export interface MissionReceipt {
  schema: "osa.mission_receipt.v1";
  mission_id: string;
  organization_id: string;
  project_id: string;
  mission_sha256: string;
  task_graph_sha256: string;
  verification_receipt_sha256: string;
  timeline_sha256: string;
  planning_receipt_sha256?: string;
  decisions_root?: string;
  reflection_sha256?: string;
  created_at: string;
  receipt_sha256: string;
}
export interface MissionRecord {
  schema: "osa.mission.v1";
  revision: number;
  mission: Mission;
  team: TeamGraph;
  state: MissionState;
  task_graph: TaskGraph;
  timeline: OSAEvent[];
  planning?: { status: "RUNNING" | "REJECTED" | "READY"; attempt_id: string; error_code?: string };
  brain?: import("./brain").BrainPlanResult;
  run?: RunResult;
  verification_receipt?: VerificationReceipt;
  mission_receipt?: MissionReceipt;
  failure?: string;
}
