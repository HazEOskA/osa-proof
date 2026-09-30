import { randomUUID } from "node:crypto";
import { BrainPlanRequest, Mission, MissionRecord, MissionState, OSAEvent, RunResult, TeamGraph } from "../../contracts/src";
import { BrainControlPlane, BrainPlanningError, reflectOnExecution, verifyBrainPlan } from "../../brain/src";
import { MemoryEventStore } from "../../events/src";
import { digest, verifyCompletedMission, verifyMissionExecution } from "../../proof-core/src";
import { getLinearExecutionOrder, validateMissionAgainstGraph, validateTeamGraph } from "../../team-graph/src";
import { ExecutorRegistry, OsaRuntime } from "./index";
import { MemoryMissionStore, MissionConflictError, MissionStore } from "./mission-store";

const transitions: Record<MissionState, MissionState[]> = {
  CREATED: ["PLANNED", "CANCELLED"], PLANNED: ["EXECUTING", "CANCELLED"],
  EXECUTING: ["VERIFYING", "FAILED"], VERIFYING: ["COMPLETED", "FAILED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};
export class MissionKernel {
  constructor(readonly store: MissionStore = new MemoryMissionStore(), private readonly clock = () => new Date(), readonly brain = new BrainControlPlane()) {}
  get(id: string): Promise<MissionRecord | undefined> { return this.store.get(id); }
  private event(record: MissionRecord, type: string, payload: Record<string, unknown> = {}, evidence: string[] = []): void {
    const previous = record.timeline.at(-1);
    const event: OSAEvent = {
      event_id: `${record.mission.mission_id}:mission:${record.timeline.length + 1}`,
      event_type: type, mission_id: record.mission.mission_id, tenant_id: record.mission.organization_id,
      source: type.startsWith("BRAIN_") ? "osa.brain" : "osa.mission-kernel", subject: record.mission.mission_id, timestamp: this.clock().toISOString(),
      correlation_id: record.mission.mission_id, causation_id: previous?.event_id, payload, evidence,
    };
    record.timeline.push(event);
  }
  private async save(record: MissionRecord): Promise<void> {
    const revision = record.revision;
    record.revision++;
    await this.store.save(record, revision);
  }
  private async transition(record: MissionRecord, next: MissionState): Promise<void> {
    if (!transitions[record.state].includes(next)) throw new MissionConflictError(`illegal mission transition ${record.state} -> ${next}`);
    if (next === "COMPLETED" && !record.verification_receipt) throw new Error("VerificationReceipt required");
    record.state = next;
    this.event(record, `MISSION_${next}`, {}, record.verification_receipt ? [record.verification_receipt.proof_id] : []);
    await this.save(record);
  }
  async create(mission: Mission, graph: TeamGraph): Promise<MissionRecord> {
    validateTeamGraph(graph);
    validateMissionAgainstGraph(graph, mission);
    if (!mission.mission_id?.trim() || !mission.objective?.trim()) throw new Error("mission_id and objective required");
    if (mission.attempt !== undefined && (!Number.isInteger(mission.attempt) || mission.attempt < 1)) throw new Error("invalid mission attempt");
    const ids = mission.requirements.map((r) => r.requirement_id);
    if (ids.some((id) => !id || id === "__runtime_execution__") || new Set(ids).size !== ids.length) throw new Error("invalid requirement identifiers");
    if (mission.requirements.some((r) => r.type !== "evidence_field_equals" || !r.evidence_kind || !r.field ||
        (r.agent_id !== undefined && !graph.agents.some((agent) => agent.agent_id === r.agent_id)))) throw new Error("invalid acceptance requirement");
    if (mission.policy?.required_receipts && (!Array.isArray(mission.policy.required_receipts) || mission.policy.required_receipts.some(kind => !["sandbox_receipt","build_receipt","image_receipt","deployment_receipt","live_verification_receipt"].includes(kind)))) throw new Error("invalid required receipt policy");
    const order = getLinearExecutionOrder(graph, mission.entry_agent_id);
    if (mission.budget && (!Number.isInteger(mission.budget.max_tasks) || mission.budget.max_tasks < 1 || order.length > mission.budget.max_tasks)) throw new Error("mission task budget exceeded or invalid");
    if (mission.policy && order.some((id) => !mission.policy!.allowed_executor_refs.includes(graph.agents.find((agent) => agent.agent_id === id)!.executor_ref))) throw new Error("executor denied by mission policy");
    const record: MissionRecord = {
      schema: "osa.mission.v1", revision: 1, mission: structuredClone(mission), team: structuredClone(graph), state: "CREATED",
      task_graph: { mission_id: mission.mission_id, nodes: order.map((agent_id, index) => ({
        task_id: `${mission.mission_id}:task:${index + 1}`, mission_id: mission.mission_id, agent_id,
        depends_on: index ? [`${mission.mission_id}:task:${index}`] : [], state: "PENDING",
      })) }, timeline: [],
    };
    digest(record); // Reject non-serializable input before any persistence or execution.
    this.event(record, "MISSION_CREATED");
    await this.store.save(record);
    return structuredClone(record);
  }
  async cancel(id: string): Promise<MissionRecord> {
    const record = await this.required(id);
    if (record.planning?.status === "RUNNING") throw new MissionConflictError("active planning cannot be cancelled without a planner cancellation primitive");
    // Active cancellation requires executor cancellation; S1 refuses to pretend it stopped work.
    await this.transition(record, "CANCELLED");
    return structuredClone(record);
  }
  private async required(id: string): Promise<MissionRecord> {
    const record = await this.get(id);
    if (!record) throw new Error("mission not found");
    return record;
  }
  private brainRequest(record: MissionRecord): BrainPlanRequest {
    return {
      mission: record.mission, team: record.team, task_graph: record.task_graph,
      world_state: { mission_state: "CREATED", team_version: record.team.version,
        task_states: record.task_graph.nodes.map((node) => ({ task_id: node.task_id, state: "PENDING" })) },
    };
  }
  async plan(id: string, registry?: ExecutorRegistry): Promise<MissionRecord> {
    const record = await this.required(id);
    if (record.state === "PLANNED" && record.brain) { verifyBrainPlan(record); return structuredClone(record); }
    if (record.state !== "CREATED" || record.planning?.status === "RUNNING") throw new MissionConflictError("mission is not available for planning");
    if (registry) for (const task of record.task_graph.nodes) registry.get(record.team.agents.find((agent) => agent.agent_id === task.agent_id)!.executor_ref);
    const attemptId = `planning_${randomUUID()}`;
    record.planning = { status: "RUNNING", attempt_id: attemptId };
    this.event(record, "BRAIN_PLANNING_STARTED", { attempt_id: attemptId, ...this.brain.describe() });
    await this.save(record); // Durable CAS claim before memory/model calls.
    try {
      record.brain = await this.brain.plan(this.brainRequest(record));
      verifyBrainPlan(record);
      record.planning = { status: "READY", attempt_id: attemptId };
      this.event(record, "BRAIN_PLAN_ACCEPTED", { plan_sha256: record.brain.plan.plan_sha256 }, [record.brain.planning_receipt.receipt_sha256]);
      for (const receipt of record.brain.decision_receipts) this.event(record, "BRAIN_DECISION_RECORDED", { task_id: receipt.task_id, selection: receipt.selection }, [receipt.receipt_sha256]);
      await this.transition(record, "PLANNED");
      return structuredClone(record);
    } catch (error) {
      if (error instanceof MissionConflictError) throw error;
      const code = error instanceof BrainPlanningError ? error.code : "PLANNING_FAILED";
      // Never overwrite another owner/cancellation and never persist remote/model error text.
      const current = await this.required(id);
      if (current.state === "CREATED" && current.planning?.status === "RUNNING" && current.planning.attempt_id === attemptId) {
        current.planning = { status: "REJECTED", attempt_id: attemptId, error_code: code };
        this.event(current, "BRAIN_PLAN_REJECTED", { attempt_id: attemptId, error_code: code });
        await this.save(current);
      }
      throw new BrainPlanningError(code);
    }
  }
  async execute(id: string, registry: ExecutorRegistry): Promise<RunResult> {
    let record = await this.required(id);
    if (record.state === "COMPLETED" && record.run) {
      verifyCompletedMission(record);
      return structuredClone(record.run);
    }
    if (record.state === "CREATED") record = await this.plan(id, registry);
    if (record.state === "PLANNED") verifyBrainPlan(record);
    for (const task of record.task_graph.nodes) registry.get(record.team.agents.find((agent) => agent.agent_id === task.agent_id)!.executor_ref);
    await this.transition(record, "EXECUTING"); // CAS wins before spawning any executor.
    const events = new MemoryEventStore();
    const runtime = new OsaRuntime(registry, { eventStore: {
      list: (runId) => events.list(runId),
      append: async (event) => {
        await events.append(event);
        const refs = [event.payload.evidence_id, event.payload.proof_id].filter((value): value is string => typeof value === "string");
        this.event(record, event.type, { ...event.payload, run_id: event.run_id, execution_id: event.execution_id, agent_id: event.agent_id }, refs);
        const task = record.task_graph.nodes.find((node) => node.agent_id === event.agent_id);
        if (task && event.type === "AGENT_STARTED") {
          if (task.depends_on.some((id) => record.task_graph.nodes.find((node) => node.task_id === id)?.state !== "COMPLETED")) throw new Error("task dependency not completed");
          task.state = "EXECUTING";
        }
        if (task && event.type === "AGENT_COMPLETED") task.state = "COMPLETED";
        if (task && event.type === "AGENT_FAILED") task.state = "FAILED";
        if (event.type === "VERIFICATION_STARTED") await this.transition(record, "VERIFYING");
        else await this.save(record);
      },
    }, clock: this.clock, missionPlan: record.brain?.plan });
    try {
      const run = await runtime.run(record.team, record.mission);
      verifyMissionExecution(record.team, record.mission, run);
      record.run = structuredClone(run);
      if (record.brain) {
        record.brain.reflection = reflectOnExecution(this.brainRequest(record), run);
        this.event(record, "BRAIN_REFLECTED", { verdict: run.verdict, recovery: record.brain.reflection.recovery }, [record.brain.reflection.reflection_sha256, run.proof.proof_id]);
      }
      if (run.verdict !== "VERIFIED" || run.proof.verdict !== "VERIFIED" || record.task_graph.nodes.some((node) => node.state !== "COMPLETED")) {
        record.failure = run.proof.runtime_failure ?? `verification ${run.proof.verdict}`;
        await this.transition(record, "FAILED");
      } else {
        if (record.state !== "VERIFYING") throw new Error("mission must be VERIFYING before completion");
        record.verification_receipt = structuredClone(run.proof);
        // Seal the final timeline and receipt atomically with completion.
        record.state = "COMPLETED";
        this.event(record, "MISSION_COMPLETED", {}, [run.proof.proof_id]);
        const body = {
          schema: "osa.mission_receipt.v1" as const, mission_id: id, organization_id: record.mission.organization_id,
          project_id: record.mission.project_id, mission_sha256: digest(record.mission), task_graph_sha256: digest(record.task_graph),
          verification_receipt_sha256: run.proof.receipt_sha256, timeline_sha256: digest(record.timeline), created_at: this.clock().toISOString(),
          ...(record.brain ? { planning_receipt_sha256: record.brain.planning_receipt.receipt_sha256,
            decisions_root: digest(record.brain.decision_receipts), reflection_sha256: record.brain.reflection!.reflection_sha256 } : {}),
        };
        record.mission_receipt = { ...body, receipt_sha256: digest(body) };
        verifyCompletedMission(record);
        await this.save(record);
      }
      return run;
    } catch (error) {
      // Storage/conflict failures must never overwrite a newer owner's snapshot.
      if (!(error instanceof MissionConflictError) && transitions[record.state].includes("FAILED")) {
        record.failure = error instanceof Error ? error.message : String(error);
        await this.transition(record, "FAILED");
      }
      throw error;
    }
  }
}
