import { Mission, MissionRecord, RunResult, TeamGraph } from "../../contracts/src";
import { bindingFor, DeterministicProofVerifier, digest, verifyProofReceipt } from "./index";
import { getLinearExecutionOrder, validateMissionAgainstGraph } from "../../team-graph/src";
import { verifyBrainPlan } from "../../brain/src/plan";
import { reflectOnExecution } from "../../brain/src";

// Integrity is necessary but not sufficient: re-evaluate the actual Mission's
// requirements and binding. A caller cannot choose the expected tenant or verdict.
export function verifyMissionExecution(graph: TeamGraph, mission: Mission, run: RunResult): void {
  validateMissionAgainstGraph(graph, mission);
  const integrity = verifyProofReceipt({ receipt: run.proof, evidence: run.evidence, observations: run.observations, final_output: run.final_output });
  const binding = bindingFor(graph, mission, run.run_id, run.execution_id);
  const expected = new DeterministicProofVerifier().verify({
    graph, mission, run_id: run.run_id, execution_id: run.execution_id,
    evidence: run.evidence, final_output: run.final_output, runtime_failure: run.proof.runtime_failure, created_at: run.proof.created_at,
  });
  if (!integrity.ok || digest(binding) !== digest(run.proof.binding) ||
      expected.proof.receipt_sha256 !== run.proof.receipt_sha256 || run.verdict !== run.proof.verdict) {
    throw new Error("VerificationReceipt rejected");
  }
}

export function verifyCompletedMission(record: MissionRecord): void {
  if (record.state !== "COMPLETED" || !record.run || !record.verification_receipt || !record.mission_receipt) throw new Error("completed mission receipts required");
  verifyMissionExecution(record.team, record.mission, record.run);
  const order = getLinearExecutionOrder(record.team, record.mission.entry_agent_id);
  const expectedTasks = { mission_id: record.mission.mission_id, nodes: order.map((agent_id, index) => ({
    task_id: `${record.mission.mission_id}:task:${index + 1}`, mission_id: record.mission.mission_id, agent_id,
    depends_on: index ? [`${record.mission.mission_id}:task:${index}`] : [], state: "COMPLETED",
  })) };
  const { receipt_sha256, ...body } = record.mission_receipt;
  if (record.brain) {
    verifyBrainPlan(record);
    const reflection = reflectOnExecution({ mission: record.mission, team: record.team, task_graph: record.task_graph, world_state: record.brain.world_state }, record.run);
    if (record.planning?.status !== "READY" || body.planning_receipt_sha256 !== record.brain.planning_receipt.receipt_sha256 ||
        body.decisions_root !== digest(record.brain.decision_receipts) || body.reflection_sha256 !== reflection.reflection_sha256 ||
        digest(record.brain.reflection) !== digest(reflection)) throw new Error("MissionReceipt brain binding rejected");
  } else if (record.planning || body.planning_receipt_sha256 || body.decisions_root || body.reflection_sha256 ||
      record.timeline.some((event) => event.event_type.startsWith("BRAIN_"))) throw new Error("MissionReceipt brain required");
  if (record.run.verdict !== "VERIFIED" || digest(record.verification_receipt) !== digest(record.run.proof) ||
      receipt_sha256 !== digest(body) || body.mission_id !== record.mission.mission_id ||
      body.organization_id !== record.mission.organization_id || body.project_id !== record.mission.project_id ||
      body.mission_sha256 !== digest(record.mission) || body.task_graph_sha256 !== digest(record.task_graph) ||
      body.verification_receipt_sha256 !== record.run.proof.receipt_sha256 || body.timeline_sha256 !== digest(record.timeline) ||
      digest(record.task_graph) !== digest(expectedTasks)) throw new Error("MissionReceipt rejected");
}
