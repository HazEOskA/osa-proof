import { BrainPlanProposal, BrainPlanRequest, BrainPlanResult, BrainScope, DecisionReceipt, MissionPlan, MissionRecord, PlanningReceipt } from "../../contracts/src";
import { canonicalJson, digest, digestWithout } from "../../proof-core/src/canonical";
import { getLinearExecutionOrder, validateMissionAgainstGraph } from "../../team-graph/src";

export class BrainPlanningError extends Error {
  constructor(readonly code: string) { super(code); this.name = "BrainPlanningError"; }
}
export const MAX_PLAN_BYTES = 128 * 1024;
export function scopeFor(request: BrainPlanRequest): BrainScope {
  const { organization_id, project_id, mission_id } = request.mission;
  return { organization_id, project_id, mission_id };
}
function invalid(): never { throw new BrainPlanningError("INVALID_PLAN"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) invalid();
  return value.trim();
}
export function validateProposal(value: unknown, request: BrainPlanRequest): BrainPlanProposal {
  if (Buffer.byteLength(canonicalJson(value)) > MAX_PLAN_BYTES) invalid();
  const proposal = object(value);
  onlyKeys(proposal, ["summary", "goals", "tasks"]);
  const summary = text(proposal.summary, 4096);
  if (!Array.isArray(proposal.goals) || proposal.goals.length < 1 || proposal.goals.length > 32) invalid();
  const goals = proposal.goals.map((goal) => text(goal, 4096));
  if (!Array.isArray(proposal.tasks) || proposal.tasks.length !== request.task_graph.nodes.length) invalid();
  const tasks = proposal.tasks.map((value, index) => {
    const task = object(value); onlyKeys(task, ["task_id", "agent_id", "instruction"]);
    const expected = request.task_graph.nodes[index];
    if (task.task_id !== expected.task_id || task.agent_id !== expected.agent_id) invalid();
    return { task_id: expected.task_id, agent_id: expected.agent_id, instruction: text(task.instruction, 8192) };
  });
  return { summary, goals, tasks };
}
export function enforceBrainPolicy(request: BrainPlanRequest, modelRefs: readonly string[]): void {
  validateMissionAgainstGraph(request.team, request.mission);
  const order = getLinearExecutionOrder(request.team, request.mission.entry_agent_id);
  const expectedGraph = { mission_id: request.mission.mission_id, nodes: order.map((agent_id, index) => ({
    task_id: `${request.mission.mission_id}:task:${index + 1}`, mission_id: request.mission.mission_id, agent_id,
    depends_on: index ? [`${request.mission.mission_id}:task:${index}`] : [], state: "PENDING",
  })) };
  if (digest(request.task_graph) !== digest(expectedGraph)) invalid();
  const allowed = request.mission.policy?.allowed_executor_refs;
  if (allowed && order.some((id) => !allowed.includes(request.team.agents.find((agent) => agent.agent_id === id)!.executor_ref))) throw new BrainPlanningError("EXECUTOR_DENIED");
  const allowedModels = request.mission.policy?.allowed_model_refs;
  const taskModels = request.team.agents.filter((agent) => order.includes(agent.agent_id)).flatMap((agent) => agent.model_ref ? [agent.model_ref] : []);
  if (allowedModels && [...modelRefs, ...taskModels].some((ref) => !allowedModels.includes(ref))) throw new BrainPlanningError("MODEL_DENIED");
  const budget = request.mission.budget;
  if (budget && (!Number.isInteger(budget.max_tasks) || budget.max_tasks < order.length)) throw new BrainPlanningError("TASK_BUDGET_EXCEEDED");
  const chars = budget?.max_context_chars;
  if (chars !== undefined && (!Number.isInteger(chars) || chars < 512 || chars > 64000)) throw new BrainPlanningError("INVALID_CONTEXT_BUDGET");
}
export function buildPlan(request: BrainPlanRequest, proposal: BrainPlanProposal): MissionPlan {
  const body = {
    schema: "osa.mission_plan.v1" as const, scope: scopeFor(request), mission_sha256: digest(request.mission), team_sha256: digest(request.team),
    summary: proposal.summary, goals: proposal.goals,
    tasks: proposal.tasks.map((task, index) => {
      const agent = request.team.agents.find((agent) => agent.agent_id === task.agent_id)!;
      return { ...task, depends_on: request.task_graph.nodes[index].depends_on, executor_ref: agent.executor_ref,
        ...(agent.model_ref ? { model_ref: agent.model_ref } : {}), framework_ref: "osa.native" as const };
    }), risk: "UNASSESSED" as const,
  };
  return { ...body, plan_sha256: digest(body) };
}
export function buildDecisions(request: BrainPlanRequest, plan: MissionPlan): DecisionReceipt[] {
  return plan.tasks.map((task) => {
    const agent = request.team.agents.find((agent) => agent.agent_id === task.agent_id)!;
    const body = {
      schema: "osa.decision_receipt.v1" as const, scope: scopeFor(request), task_id: task.task_id,
      selection: { agent_id: agent.agent_id, executor_ref: agent.executor_ref, ...(agent.model_ref ? { model_ref: agent.model_ref } : {}),
        framework_ref: "osa.native" as const, declared_tool_capabilities: agent.tool_capabilities ?? [] },
      reason: "PINNED_TEAM_GRAPH" as const, policy_sha256: digest(request.mission.policy ?? null), budget_sha256: digest(request.mission.budget ?? null),
    };
    return { ...body, receipt_sha256: digest(body) };
  });
}
export function verifyRuntimePlan(team: BrainPlanRequest["team"], mission: BrainPlanRequest["mission"], plan: MissionPlan): void {
  const order = getLinearExecutionOrder(team, mission.entry_agent_id);
  const request: BrainPlanRequest = {
    mission, team, task_graph: { mission_id: mission.mission_id, nodes: order.map((agent_id, index) => ({
      task_id: `${mission.mission_id}:task:${index + 1}`, mission_id: mission.mission_id, agent_id,
      depends_on: index ? [`${mission.mission_id}:task:${index}`] : [], state: "PENDING",
    })) }, world_state: { mission_state: "CREATED", team_version: team.version, task_states: [] },
  };
  enforceBrainPolicy(request, []);
  const proposal = validateProposal({ summary: plan.summary, goals: plan.goals,
    tasks: plan.tasks.map(({ task_id, agent_id, instruction }) => ({ task_id, agent_id, instruction })) }, request);
  if (digest(plan) !== digest(buildPlan(request, proposal))) throw new BrainPlanningError("RUNTIME_PLAN_REJECTED");
}
export function verifyBrainPlan(record: Pick<MissionRecord, "mission" | "team" | "task_graph" | "brain">): void {
  if (!record.brain) throw new BrainPlanningError("PLAN_REQUIRED");
  const result = record.brain;
  const order = getLinearExecutionOrder(record.team, record.mission.entry_agent_id);
  const pendingGraph = { mission_id: record.mission.mission_id, nodes: order.map((agent_id, index) => ({
    task_id: `${record.mission.mission_id}:task:${index + 1}`, mission_id: record.mission.mission_id, agent_id,
    depends_on: index ? [`${record.mission.mission_id}:task:${index}`] : [], state: "PENDING" as const,
  })) };
  const request: BrainPlanRequest = { mission: record.mission, team: record.team, task_graph: pendingGraph,
    world_state: result.world_state, memory: result.memory };
  enforceBrainPolicy(request, result.planning_receipt.model_refs);
  const proposal = validateProposal({ summary: result.plan.summary, goals: result.plan.goals,
    tasks: result.plan.tasks.map(({ task_id, agent_id, instruction }) => ({ task_id, agent_id, instruction })) }, request);
  const expectedPlan = buildPlan(request, proposal);
  const decisions = buildDecisions(request, expectedPlan);
  const receipt = result.planning_receipt;
  const world = { mission_state: "CREATED", team_version: record.team.version,
    task_states: pendingGraph.nodes.map((node) => ({ task_id: node.task_id, state: "PENDING" })) };
  if (digest(result.plan) !== digest(expectedPlan) || digest(result.decision_receipts) !== digest(decisions) ||
      digest(world) !== digest(result.world_state) || receipt.schema !== "osa.planning_receipt.v1" || receipt.verdict !== "ACCEPTED" ||
      receipt.receipt_sha256 !== digestWithout(receipt, "receipt_sha256") || receipt.plan_sha256 !== expectedPlan.plan_sha256 ||
      digest(receipt.scope) !== digest(scopeFor(request)) || receipt.mission_sha256 !== digest(record.mission) || receipt.team_sha256 !== digest(record.team) ||
      receipt.proposal_sha256 !== digest(proposal) || receipt.decisions_root !== digest(decisions) ||
      receipt.world_state_sha256 !== digest(world) || receipt.memory_context_sha256 !== (result.memory?.context_sha256 ?? null)) throw new BrainPlanningError("PLANNING_RECEIPT_REJECTED");
  if (result.memory) validateMemory(request, result.memory);
}
export function validateMemory(request: BrainPlanRequest, memory: NonNullable<BrainPlanResult["memory"]>): void {
  if (digest(memory.scope) !== digest(scopeFor(request)) || typeof memory.text !== "string" ||
      memory.text.length > (request.mission.budget?.max_context_chars ?? 12000) || !memory.brain_id || !memory.ledger_head ||
      !Array.isArray(memory.references) || typeof memory.truncated !== "boolean" ||
      memory.context_sha256 !== digestWithout(memory, "context_sha256")) throw new BrainPlanningError("MEMORY_CONTEXT_REJECTED");
}
export function sealPlanningReceipt(body: Omit<PlanningReceipt, "receipt_sha256">): PlanningReceipt {
  return { ...body, receipt_sha256: digest(body) };
}
