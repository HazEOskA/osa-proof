import { Mission, MissionRecord, RunResult, TeamGraph } from "../../contracts/src";
import { bindingFor, DeterministicProofVerifier, digest, verifyProofReceipt } from "./index";
import { getLinearExecutionOrder, validateMissionAgainstGraph } from "../../team-graph/src";
import { verifyBrainPlan } from "../../brain/src/plan";
import { reflectOnExecution } from "../../brain/src";

// Integrity is necessary but not sufficient: re-evaluate the actual Mission's
// requirements and binding. A caller cannot choose the expected tenant or verdict.
export function verifyMissionExecution(
  graph: TeamGraph, mission: Mission, run: RunResult,
  trustedHost: { trustedNoExternalFacts?: boolean } = {}
): void {
  validateMissionAgainstGraph(graph, mission);
  // Recheck the pinned executor policy independently of the creation path.
  // This does not attest that an executor actually ran or that its identity is authentic.
  const order = getLinearExecutionOrder(graph, mission.entry_agent_id);
  if (mission.policy && (!Array.isArray(mission.policy.allowed_executor_refs) || order.some(id =>
    !mission.policy!.allowed_executor_refs.includes(graph.agents.find(agent => agent.agent_id === id)!.executor_ref)))) {
    throw new Error("VerificationReceipt executor policy rejected");
  }
  if (run.verdict === "VERIFIED") verifyRequiredReceipts(mission,run);
  const integrity = verifyProofReceipt({ receipt: run.proof, evidence: run.evidence, observations: run.observations, final_output: run.final_output, tool_calls: run.tool_calls });
  const binding = bindingFor(graph, mission, run.run_id, run.execution_id);
  // An opt-out in a receipt is NOT authority. A separate trusted host
  // decision must be passed to re-verification; agent/mission fields are ignored.
  const expectedMode = trustedHost.trustedNoExternalFacts === true
    ? "CONTROL_PLANE_NO_EXTERNAL_FACTS" as const : "DEFAULT_ON" as const;
  if (run.proof.attribution_mode === "CONTROL_PLANE_NO_EXTERNAL_FACTS" &&
      expectedMode !== "CONTROL_PLANE_NO_EXTERNAL_FACTS") {
    throw new Error("VerificationReceipt untrusted attribution opt-out rejected");
  }
  const expected = new DeterministicProofVerifier().verify({
    graph, mission, run_id: run.run_id, execution_id: run.execution_id,
    evidence: run.evidence, tool_calls: run.tool_calls, attribution_mode: expectedMode, final_output: run.final_output, runtime_failure: run.proof.runtime_failure, created_at: run.proof.created_at,
  });
  if (!integrity.ok || digest(binding) !== digest(run.proof.binding) ||
      expected.proof.receipt_sha256 !== run.proof.receipt_sha256 || run.verdict !== run.proof.verdict) {
    throw new Error("VerificationReceipt rejected");
  }
}

export function verifyCompletedMission(record: MissionRecord): void {
  if (record.state !== "COMPLETED" || !record.run || !record.verification_receipt || !record.mission_receipt) throw new Error("completed mission receipts required");
  verifyMissionExecution(record.team, record.mission, record.run);
  // Runtime events are exported separately from the receipt-sealed mission timeline.
  // Reconcile the two so a modified replay cannot pass by retaining an intact receipt.
  const projected = record.timeline.filter(event => event.payload.run_id !== undefined || event.payload.execution_id !== undefined);
  if (projected.length !== record.run.events.length || record.run.events.some((event, index) => {
    const entry = projected[index];
    return event.sequence !== index + 1 || event.event_id !== `${record.run!.run_id}:${record.run!.execution_id}:event:${index + 1}` ||
      event.run_id !== record.run!.run_id || event.execution_id !== record.run!.execution_id ||
      event.mission_id !== record.mission.mission_id || event.organization_id !== record.mission.organization_id ||
      event.project_id !== record.mission.project_id || event.team_id !== record.team.team_id || event.team_version !== record.team.version ||
      !entry || entry.event_type !== event.type || digest(entry.payload) !== digest({ ...event.payload, run_id: event.run_id, execution_id: event.execution_id, agent_id: event.agent_id });
  })) throw new Error("MissionReceipt runtime replay rejected");
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
  verifyReplayCompleteness(record, order);
}

// Structural consistency only: an unanchored bundle can still be forged in its
// entirety. Do not confuse this with authenticated provenance of execution.
function verifyReplayCompleteness(record: MissionRecord, order: string[]): void {
  const run = record.run!;
  const fail = (): never => { throw new Error("MissionReceipt replay incomplete or inconsistent"); };
  for (let i = 0; i < record.timeline.length; i++) {
    const event = record.timeline[i];
    if (event.event_id !== `${record.mission.mission_id}:mission:${i + 1}` || event.mission_id !== record.mission.mission_id ||
        event.tenant_id !== record.mission.organization_id || event.subject !== record.mission.mission_id ||
        event.correlation_id !== record.mission.mission_id || event.causation_id !== (i ? record.timeline[i - 1].event_id : undefined) ||
        event.source !== (event.event_type.startsWith("BRAIN_") ? "osa.brain" : "osa.mission-kernel") ||
        typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) fail();
  }
  const lifecycle = record.timeline.filter(event => event.event_type.startsWith("MISSION_")).map(event => event.event_type);
  if (digest(lifecycle) !== digest(["MISSION_CREATED", "MISSION_PLANNED", "MISSION_EXECUTING", "MISSION_VERIFYING", "MISSION_COMPLETED"])) fail();
  let cursor = 0, evidenceIndex = 0, toolIndex = 0;
  const take = (type: string, agentId?: string) => {
    const event = run.events[cursor++];
    if (!event || event.type !== type || event.agent_id !== agentId) fail();
    return event;
  };
  const created = take("RUN_CREATED");
  if (created.payload.objective !== record.mission.objective) fail();
  take("RUN_STARTED");
  order.forEach((agentId, index) => {
    const agent = record.team.agents.find(item => item.agent_id === agentId)!;
    const operation = `${run.execution_id}:op:${index + 1}:${agentId}`;
    const started = take("AGENT_STARTED", agentId);
    if (started.payload.executor_ref !== agent.executor_ref || started.payload.role !== agent.role || started.payload.operation_id !== operation) fail();
    while (run.events[cursor]?.type === "TOOL_CALL_STARTED") {
      const startedTool = take("TOOL_CALL_STARTED", agentId);
      const tool = (run.tool_calls ?? [])[toolIndex++];
      if (!tool || tool.agent_id !== agentId || tool.operation_id !== operation ||
          tool.run_id !== run.run_id || tool.execution_id !== run.execution_id ||
          startedTool.payload.tool_call_id !== tool.tool_call_id ||
          startedTool.payload.request_sha256 !== tool.request_sha256 ||
          startedTool.payload.tool_ref !== tool.tool_ref) fail();
      const doneTool = take("TOOL_CALL_COMPLETED", agentId);
      if (doneTool.payload.tool_call_id !== tool.tool_call_id ||
          doneTool.payload.record_sha256 !== tool.record_sha256 ||
          doneTool.payload.response_sha256 !== tool.response_sha256 ||
          doneTool.payload.tool_ref !== tool.tool_ref) fail();
    }
    while (run.events[cursor]?.type === "EVIDENCE_RECORDED") {
      const event = take("EVIDENCE_RECORDED", agentId), evidence = run.evidence[evidenceIndex++];
      if (!evidence || evidence.sequence !== evidenceIndex || evidence.evidence_id !== `${run.run_id}:${run.execution_id}:evidence:${evidenceIndex}` ||
          evidence.agent_id !== agentId || evidence.producer.executor_ref !== agent.executor_ref || evidence.producer.operation_id !== operation ||
          event.payload.evidence_id !== evidence.evidence_id || event.payload.evidence_sha256 !== evidence.evidence_sha256 || event.payload.kind !== evidence.kind) fail();
    }
    take("AGENT_COMPLETED", agentId);
    if (order[index + 1]) {
      const handoff = take("HANDOFF_CREATED", agentId);
      if (handoff.payload.from_agent_id !== agentId || handoff.payload.to_agent_id !== order[index + 1]) fail();
    }
  });
  if (evidenceIndex !== run.evidence.length || toolIndex !== (run.tool_calls?.length ?? 0)) fail();
  if (take("VERIFICATION_STARTED").payload.requirement_count !== record.mission.requirements.length) fail();
  for (const claim of run.proof.claim_attribution ?? []) {
    const ev = take("CLAIM_ATTRIBUTION_CHECKED");
    if (ev.payload.claim_sha256 !== claim.claim_sha256 || ev.payload.claim !== claim.claim ||
        ev.payload.kind !== claim.kind || ev.payload.status !== claim.status ||
        ev.payload.reason_code !== claim.reason_code ||
        ev.payload.tool_call_id !== claim.tool_call_id ||
        ev.payload.response_sha256 !== claim.response_sha256) fail();
  }
  if (take("VERIFICATION_PASSED").payload.proof_id !== run.proof.proof_id || take("RUN_VERIFIED").payload.proof_id !== run.proof.proof_id || cursor !== run.events.length) fail();
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
