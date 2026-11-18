import type { MissionRecord } from "../../../packages/contracts/src";
import { FileDurableJobStore } from "../../../packages/durable-execution/src";
import { digest } from "../../../packages/proof-core/src";

/**
 * MissionStore is not the durable completion authority. A worker may persist
 * VERIFIED before its lease is rejected. Publish only when the authoritative
 * job is COMPLETED and explicitly references this exact run and mission.
 */
export async function publishedDurableMissionIds(store: FileDurableJobStore): Promise<Map<string, { run_id:string; receipt_sha256:string }>> {
  const published = new Map<string, { run_id:string; receipt_sha256:string }>();
  for (const job of await store.listRecords()) {
    if (job.status !== "COMPLETED") continue;
    const checked = await store.publicStatus(job);
    if (checked.status !== "COMPLETED") continue;
    const result = checked.result as {
      status?: string;
      audit?: { mission_id?: string; run_id?: string; proof?: { receipt_sha256?: string } };
      mission?: { mission_id?: string };
      run?: { run_id?: string; proof?: { receipt_sha256?: string } };
    } | undefined;
    if (!result) continue;
    const missionId = job.input.kind === "model"
      ? "chat_" + digest([job.scope.organization_id, job.scope.project_id, job.scope.identity_id, job.input.execution_id])
      : "delivery_" + digest([job.scope.organization_id, job.scope.project_id, job.scope.identity_id, job.input.execution_id]);
    const confirmed = job.input.kind === "model"
      ? result.status === "PROVIDER_RESPONSE" && result.audit?.mission_id === missionId && !!result.audit.run_id
      : result.status === "EXECUTED" && result.mission?.mission_id === missionId && !!result.run?.run_id;
    if (confirmed) {
      const run_id=(job.input.kind === "model" ? result.audit?.run_id : result.run?.run_id)!;
      const receipt_sha256=job.input.kind === "model" ? result.audit?.proof?.receipt_sha256 : result.run?.proof?.receipt_sha256;
      if (receipt_sha256) published.set(missionId,{run_id,receipt_sha256});
    }
  }
  return published;
}

export function durableMissionVisible(record: MissionRecord, permitted: Map<string, { run_id:string; receipt_sha256:string }>): boolean {
  const accepted=permitted.get(record.mission.mission_id);
  return !!accepted && accepted.run_id === record.run?.run_id &&
    accepted.receipt_sha256 === record.run?.proof?.receipt_sha256 &&
    record.state === "COMPLETED" && record.run?.verdict === "VERIFIED" &&
    record.run?.proof?.mission_id === record.mission.mission_id;
}
