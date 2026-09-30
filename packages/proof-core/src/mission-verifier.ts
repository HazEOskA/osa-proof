import { Mission, MissionRecord, RunResult, TeamGraph } from "../../contracts/src";
import { bindingFor, DeterministicProofVerifier, digest, verifyProofReceipt } from "./index";
import { getLinearExecutionOrder, validateMissionAgainstGraph } from "../../team-graph/src";
import { verifyBrainPlan } from "../../brain/src/plan";
import { reflectOnExecution } from "../../brain/src";

// Integrity is necessary but not sufficient: re-evaluate the actual Mission's
// requirements and binding. A caller cannot choose the expected tenant or verdict.
export function verifyMissionExecution(graph: TeamGraph, mission: Mission, run: RunResult): void {
  validateMissionAgainstGraph(graph, mission);
  if (run.verdict === "VERIFIED") verifyRequiredReceipts(mission,run);
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

// Same-process provenance/integrity gate, not a cryptographic external attestation.
function verifyRequiredReceipts(mission: Mission, run: RunResult): void {
  const required = mission.policy?.required_receipts ?? [];
  const kinds = new Set(required);
  if (kinds.has("live_verification_receipt")) for (const kind of ["build_receipt","image_receipt","deployment_receipt"]) kinds.add(kind as typeof required[number]);
  const receipts = new Map<string, Record<string,unknown>>();
  for (const kind of kinds) {
    if (!["sandbox_receipt","build_receipt","image_receipt","deployment_receipt","live_verification_receipt"].includes(kind)) throw new Error("REQUIRED_RECEIPT_KIND_INVALID");
    const candidates = run.evidence.filter(e => e.kind === kind);
    if (!candidates.length) throw new Error("REQUIRED_RECEIPT_MISSING");
    for (const evidence of candidates) {
      const receipt = (evidence.data.receipt ?? evidence.data) as Record<string,unknown>;
      const { receipt_sha256, ...body } = receipt;
      if (receipt_sha256 !== digest(body) || receipt.schema !== `osa.${kind}.v1` || receipt.mission_id !== mission.mission_id || receipt.organization_id !== mission.organization_id || receipt.project_id !== mission.project_id) throw new Error("REQUIRED_RECEIPT_INVALID");
      if (kind === "build_receipt") {
        const checks = receipt.checks as Array<{name:string;exit_code:number}>;
        if (!Array.isArray(checks) || checks.length !== 2 || new Set(checks.map(c => c.name)).size !== 2 || checks.some(c => !["BUILD","TEST"].includes(c.name) || c.exit_code !== 0) || !/^[a-f0-9]{64}$/.test(String(receipt.artifact_sha256))) throw new Error("BUILD_RECEIPT_GATES_INVALID");
      }
      if (kind === "image_receipt" && !/^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(String(receipt.image))) throw new Error("IMAGE_RECEIPT_DIGEST_INVALID");
      receipts.set(String(receipt_sha256),receipt);
    }
  }
  if (kinds.has("live_verification_receipt")) {
    const valid = [...receipts.values()].some(live => {
      if (live.schema !== "osa.live_verification_receipt.v1" || live.http_status !== 200 || typeof live.url !== "string" || !live.url.startsWith("https://")) return false;
      const deployment = receipts.get(String(live.deployment_receipt_sha256));
      if (!deployment || deployment.schema !== "osa.deployment_receipt.v1" || deployment.plan_sha256 !== live.plan_sha256) return false;
      const images = [...receipts.values()].filter(r => r.schema === "osa.image_receipt.v1" && r.image === deployment.image);
      return images.some(image => receipts.get(String(image.build_receipt_sha256))?.schema === "osa.build_receipt.v1");
    });
    if (!valid) throw new Error("LIVE_RECEIPT_CHAIN_INVALID");
  }
}
