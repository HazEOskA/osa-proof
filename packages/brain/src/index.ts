import { BrainMemory, BrainPlanRequest, BrainPlanResult, BrainPlanner, BrainReflection, RunResult } from "../../contracts/src";
import { canonicalJson, digest } from "../../proof-core/src/canonical";
import { BrainPlanningError, buildDecisions, buildPlan, enforceBrainPolicy, scopeFor, sealPlanningReceipt, validateMemory, validateProposal } from "./plan";
export * from "./plan";

// Compatibility compiler: honest native plan from the already pinned TeamGraph.
// Model-backed intent/decomposition is a separately configured planner adapter.
export class NativeBrainPlanner implements BrainPlanner {
  readonly id = "osa.brain.native.v1";
  readonly mode = "native" as const;
  readonly model_refs: string[] = [];
  async propose(request: BrainPlanRequest) {
    return { proposal: { summary: request.mission.objective, goals: [request.mission.objective], tasks: request.task_graph.nodes.map((node) => ({
      task_id: node.task_id, agent_id: node.agent_id,
      instruction: `As ${request.team.agents.find((agent) => agent.agent_id === node.agent_id)!.role}, work toward: ${request.mission.objective}`,
    })) }, evidence: { source: "canonical_team_graph", team_sha256: digest(request.team) } };
  }
}
export class BrainControlPlane {
  constructor(readonly planner: BrainPlanner = new NativeBrainPlanner(), readonly memory?: BrainMemory, private readonly clock = () => new Date()) {}
  describe(): Record<string, unknown> {
    return { planner_id: this.planner.id, mode: this.planner.mode, model_refs: [...this.planner.model_refs], memory: this.memory?.id ?? "NONE", adaptive_routing: false, risk: "UNASSESSED" };
  }
  async plan(input: BrainPlanRequest): Promise<BrainPlanResult> {
    const request = structuredClone(input);
    enforceBrainPolicy(request, this.planner.model_refs); // before memory/model network calls
    if (Buffer.byteLength(canonicalJson(request)) > 512 * 1024) throw new BrainPlanningError("BRAIN_INPUT_TOO_LARGE");
    if (this.memory) {
      request.memory = await this.memory.recall(scopeFor(request), request.mission.objective, request.mission.budget?.max_context_chars ?? 12000);
    }
    if (request.memory) validateMemory(request, request.memory);
    if (Buffer.byteLength(canonicalJson(request)) > 1024 * 1024) throw new BrainPlanningError("BRAIN_CONTEXT_TOO_LARGE");
    const generated = await this.planner.propose(structuredClone(request));
    const proposal = validateProposal(generated.proposal, request);
    if (!generated.evidence || typeof generated.evidence !== "object" || Array.isArray(generated.evidence)) throw new BrainPlanningError("INVALID_PLANNER_EVIDENCE");
    const plan = buildPlan(request, proposal);
    const decisions = buildDecisions(request, plan);
    const receipt = sealPlanningReceipt({
      schema: "osa.planning_receipt.v1", scope: scopeFor(request), planner_id: this.planner.id, mode: this.planner.mode,
      model_refs: [...this.planner.model_refs], mission_sha256: digest(request.mission), team_sha256: digest(request.team),
      plan_sha256: plan.plan_sha256, proposal_sha256: digest(proposal), world_state_sha256: digest(request.world_state),
      memory_context_sha256: request.memory?.context_sha256 ?? null, decisions_root: digest(decisions),
      evidence: structuredClone(generated.evidence), created_at: this.clock().toISOString(), verdict: "ACCEPTED",
    });
    return { plan, planning_receipt: receipt, decision_receipts: decisions, world_state: request.world_state, ...(request.memory ? { memory: request.memory } : {}) };
  }
}
export function reflectOnExecution(request: BrainPlanRequest, run: RunResult): BrainReflection {
  const body = {
    schema: "osa.brain_reflection.v1" as const, scope: scopeFor(request), execution_id: run.execution_id,
    proof_receipt_sha256: run.proof.receipt_sha256, verdict: run.proof.verdict,
    failed_requirements: run.proof.requirement_verdicts.filter((r) => r.verdict !== "VERIFIED").map((r) => r.requirement_id),
    recovery: run.proof.verdict === "VERIFIED" ? "NONE" as const : "REVIEW_REQUIRED" as const,
  };
  return { ...body, reflection_sha256: digest(body) };
}
