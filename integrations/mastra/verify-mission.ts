// Use OSA Proof's canonical verifier instead of reimplementing digest logic.
// This verifies same-process provenance/integrity, NOT externally anchored attestation.
import type { MissionRecord } from "../../packages/contracts/src/mission-kernel";
import { verifyCompletedMission } from "../../packages/proof-core/src/mission-verifier";
import { digest } from "../../packages/proof-core/src/canonical";

export function verifyMastraOsaMissionRecord(record: MissionRecord, expected: {
  mission_id: string; run_id: string; execution_id: string; receipt_sha256: string;
}): true {
  if (record.mission.mission_id !== expected.mission_id ||
      record.run?.run_id !== expected.run_id ||
      record.run?.execution_id !== expected.execution_id ||
      record.mission_receipt?.receipt_sha256 !== expected.receipt_sha256) {
    throw new Error("MASTRA_OSA_BINDING_MISMATCH");
  }
  verifyCompletedMission(record);
  if (!record.run || !record.mission_receipt ||
      digest(record.run.proof) !== digest(record.verification_receipt)) {
    throw new Error("MASTRA_OSA_VERIFICATION_MISSING");
  }
  return true;
}
