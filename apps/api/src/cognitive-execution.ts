import type { ClaimEnforcement, Mission, MissionRecord, TeamGraph } from "../../../packages/contracts/src";
import { ExecutorRegistry, MissionKernel } from "../../../packages/runtime/src";
import { BrainControlPlane, verifyBrainPlan } from "../../../packages/brain/src";

/**
 * The route has already authorized or fetched its own scoped memory. Avoid a
 * second NeurOSA lookup while retaining the actual configured planner, policy,
 * MissionStore, MissionKernel lifecycle and APR verification. The plan receipt
 * does not claim to include memory that was not supplied to the planner.
 */
export function planningOnlyKernel(parent: MissionKernel, onRecord?: (record: MissionRecord) => void, claimEnforcement:ClaimEnforcement="ENFORCE"): MissionKernel {
  return new MissionKernel(parent.store,undefined,new BrainControlPlane(parent.brain.planner),onRecord,claimEnforcement);
}

/**
 * One canonical path for API entrypoints that execute agents or tools.
 * A plan receipt is mandatory BEFORE the executor may run.
 * A run proof is mandatory even when the final verdict is FAILED.
 *
 * Planning and proof verification are structural. They do NOT attest to
 * arbitrary factual accuracy or semantic quality of a model response.
 */
export async function executeCognitiveMission(
  kernel: MissionKernel,
  registry: ExecutorRegistry,
  team: TeamGraph,
  mission: Mission,
  executionId: string,
  onPlanned?: () => void,
) {
  await kernel.create(mission, team);
  const planned = await kernel.plan(mission.mission_id, registry);
  if (!planned.brain?.planning_receipt?.receipt_sha256) throw Error("COGNITIVE_PLAN_MISSING");
  verifyBrainPlan(planned);
  onPlanned?.();
  const run = await kernel.execute(mission.mission_id, registry, { execution_id: executionId });
  if (!run?.proof?.receipt_sha256) throw Error("APR_PROOF_MISSING");
  const record = await kernel.get(mission.mission_id);
  if (!record?.brain?.planning_receipt || !record.run) throw Error("COGNITIVE_EXECUTION_RECORD_MISSING");
  return {run, record};
}
