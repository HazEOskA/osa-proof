import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentExecutionContext, Mission, MissionRecord, TeamGraph } from "../../contracts/src";
import { FleetQueue } from "../../fleet/src";
import { verifyCompletedMission, verifyProofReceipt } from "../../proof-core/src";
import { ExecutorRegistry, MissionKernel } from "../../runtime/src";

/**
 * P1 transport-neutral contract callable by Hermes. OSA remains authoritative.
 * Two real in-process, scoped FleetQueue leases; NOT remote Hermes delegates,
 * parallel execution, a distributed broker, or independent signed attestation.
 * No file writes, no provider keys, no network calls.
 */
export interface HermesP1Request {
  mission_id: string;
  relative_file: string;
}

export interface HermesP1Scope {
  workspace_root: string;
  organization_id: string;
  project_id: string;
  allowed_files: readonly string[];
}

export interface P1WorkerAssignment {
  agent_id: string;
  worker_id: string;
  job_id: string;
  execution_id: string;
}

export interface HermesP1Bundle {
  schema: "osa.hermes_fleet_p1.v1";
  record: MissionRecord;
  assignments: P1WorkerAssignment[];
}

const INSPECT = "osa.p1.readonly.inspect.v1";
const VERIFY = "osa.p1.readonly.verify.v1";
const INSPECT_WORKER = "osa-p1-inspector";
const VERIFY_WORKER = "osa-p1-verifier";
const MAX_FILE_BYTES = 1024 * 1024;

function assertAllowedFile(file: string, allowlist: readonly string[]): void {
  if (typeof file !== "string" || file.length === 0 || isAbsolute(file) ||
      file.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..") ||
      !allowlist.includes(file)) {
    throw new Error("P1_FILE_NOT_ALLOWED");
  }
}

async function sourceDigest(root: string, file: string): Promise<{ sha256: string; bytes: number }> {
  const rootReal = await realpath(root);
  const target = resolve(rootReal, file);
  const targetRelative = relative(rootReal, target);
  if (targetRelative === ".." || targetRelative.startsWith(".." + sep) || isAbsolute(targetRelative))
    throw new Error("P1_PATH_ESCAPE");
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES)
    throw new Error("P1_FILE_TYPE_OR_SIZE_DENIED");
  const targetReal = await realpath(target);
  const realRelative = relative(rootReal, targetReal);
  if (realRelative === ".." || realRelative.startsWith(".." + sep) || isAbsolute(realRelative))
    throw new Error("P1_SYMLINK_ESCAPE");
  const bytes = await readFile(targetReal);
  if (bytes.length > MAX_FILE_BYTES) throw new Error("P1_FILE_TOO_LARGE");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

function missionGraph(scope: HermesP1Scope, request: HermesP1Request): { mission: Mission; graph: TeamGraph } {
  const graph: TeamGraph = {
    organization_id: scope.organization_id,
    project_id: scope.project_id,
    team_id: "osa-hermes-fleet-p1", version: "1",
    agents: [
      { agent_id: "inspect", role: "read-only-inspector", executor_ref: INSPECT },
      { agent_id: "verify", role: "read-only-verifier", executor_ref: VERIFY },
    ],
    edges: [{ edge_id: "inspect-to-verify", from_agent_id: "inspect", to_agent_id: "verify", kind: "handoff" }],
  };
  const mission: Mission = {
    organization_id: graph.organization_id, project_id: graph.project_id,
    team_id: graph.team_id, team_version: graph.version,
    mission_id: request.mission_id, entry_agent_id: "inspect",
    objective: "Read and independently hash one allowlisted repository file",
    input: { relative_file: request.relative_file },
    policy: { allowed_executor_refs: [INSPECT, VERIFY] },
    budget: { max_tasks: 2 },
    requirements: [
      { requirement_id: "inspection", type: "evidence_field_equals", evidence_kind: "osa.p1.inspect.v1", agent_id: "inspect", field: "status", expected: "OK" },
      { requirement_id: "verification", type: "evidence_field_equals", evidence_kind: "osa.p1.verify.v1", agent_id: "verify", field: "status", expected: "VERIFIED" },
    ],
  };
  return { mission, graph };
}

export function verifyHermesP1Bundle(bundle: HermesP1Bundle): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (bundle.schema !== "osa.hermes_fleet_p1.v1" || bundle.record.state !== "COMPLETED" || !bundle.record.run) {
    return { ok: false, errors: ["P1_BUNDLE_NOT_COMPLETED"] };
  }
  try { verifyCompletedMission(bundle.record); }
  catch { errors.push("P1_MISSION_RECEIPT_INVALID"); }
  const run = bundle.record.run;
  const proof = verifyProofReceipt({
    receipt: run.proof, evidence: run.evidence, observations: run.observations,
    final_output: run.final_output,
  });
  errors.push(...proof.errors);
  const completed = run.events.filter((event) => event.type === "AGENT_COMPLETED");
  if (completed.length !== 2 || new Set(completed.map((event) => event.agent_id)).size !== 2)
    errors.push("P1_TWO_WORKERS_NOT_COMPLETED");
  if (bundle.assignments.length !== 2 ||
      new Set(bundle.assignments.map((item) => item.worker_id)).size !== 2 ||
      bundle.assignments.some((item) => item.execution_id !== run.execution_id))
    errors.push("P1_SCOPED_LEASES_MISSING");
  if (run.events.some((event) => event.execution_id !== run.execution_id) ||
      run.evidence.some((item) => item.execution_id !== run.execution_id))
    errors.push("P1_EXECUTION_ID_MISMATCH");
  return { ok: errors.length === 0, errors };
}

export async function runHermesP1(request: HermesP1Request, scope: HermesP1Scope): Promise<HermesP1Bundle> {
  if (!request.mission_id || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(request.mission_id))
    throw new Error("P1_INVALID_MISSION_ID");
  if (!scope.organization_id || !scope.project_id || !scope.workspace_root || scope.allowed_files.length === 0)
    throw new Error("P1_INVALID_SCOPE");
  assertAllowedFile(request.relative_file, scope.allowed_files);
  // Fail before accepting work if the file does not exist or escapes the workspace.
  await sourceDigest(scope.workspace_root, request.relative_file);
  const { mission, graph } = missionGraph(scope, request);
  const fleet = new FleetQueue();
  for (const worker_id of [INSPECT_WORKER, VERIFY_WORKER])
    fleet.register({ worker_id, organization_id: scope.organization_id, project_id: scope.project_id, capacity: 1 });
  const assignments: P1WorkerAssignment[] = [];
  const registry = new ExecutorRegistry();

  async function withScopedLease<T>(worker_id: string, context: AgentExecutionContext, task: () => Promise<T>): Promise<T> {
    if (context.mission.organization_id !== scope.organization_id || context.mission.project_id !== scope.project_id)
      throw new Error("P1_TENANT_SCOPE_DENIED");
    if ((worker_id === INSPECT_WORKER && context.agent.executor_ref !== INSPECT) ||
        (worker_id === VERIFY_WORKER && context.agent.executor_ref !== VERIFY))
      throw new Error("P1_CAPABILITY_DENIED");
    const job = fleet.enqueueScoped({
      mission_id: context.mission.mission_id,
      organization_id: scope.organization_id, project_id: scope.project_id,
    });
    const lease = fleet.claim(worker_id);
    if (!lease || lease.job_id !== job.job_id) throw new Error("P1_SCOPED_LEASE_UNAVAILABLE");
    try {
      const result = await task();
      fleet.complete(lease, { run_id: context.run_id, verdict: "VERIFIED" });
      assignments.push({ agent_id: context.agent.agent_id, worker_id, job_id: job.job_id, execution_id: context.execution_id });
      return result;
    } catch (error) {
      fleet.complete(lease, { error: "P1_EXECUTION_FAILED" });
      throw error;
    }
  }

  registry.register(INSPECT, async (context) => withScopedLease(INSPECT_WORKER, context, async () => {
    const file = (context.input as { relative_file?: string }).relative_file;
    if (!file) throw new Error("P1_MISSING_FILE");
    assertAllowedFile(file, scope.allowed_files);
    const digest = await sourceDigest(scope.workspace_root, file);
    return {
      output: { relative_file: file, sha256: digest.sha256, bytes: digest.bytes },
      evidence: [{ kind: "osa.p1.inspect.v1", data: { status: "OK", relative_file: file, sha256: digest.sha256 } }],
    };
  }));

  registry.register(VERIFY, async (context) => withScopedLease(VERIFY_WORKER, context, async () => {
    const incoming = context.input as { relative_file?: string; sha256?: string; bytes?: number };
    if (!incoming.relative_file) throw new Error("P1_MISSING_HANDOFF");
    assertAllowedFile(incoming.relative_file, scope.allowed_files);
    const observed = await sourceDigest(scope.workspace_root, incoming.relative_file);
    const matches = incoming.sha256 === observed.sha256 && incoming.bytes === observed.bytes;
    return {
      output: { relative_file: incoming.relative_file, sha256: observed.sha256, bytes: observed.bytes, status: matches ? "VERIFIED" : "MISMATCH" },
      evidence: [{ kind: "osa.p1.verify.v1", data: { status: matches ? "VERIFIED" : "MISMATCH", sha256: observed.sha256 } }],
    };
  }));

  const kernel = new MissionKernel();
  await kernel.create(mission, graph);
  await kernel.execute(mission.mission_id, registry);
  const record = await kernel.get(mission.mission_id);
  if (!record) throw new Error("P1_MISSION_MISSING");
  const bundle: HermesP1Bundle = { schema: "osa.hermes_fleet_p1.v1", record, assignments };
  const verification = verifyHermesP1Bundle(bundle);
  if (!verification.ok) throw new Error("P1_PROOF_REJECTED: " + verification.errors.join(","));
  return bundle;
}
