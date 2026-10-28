#!/usr/bin/env node
// Verify a saved osa.mission.v1 record and any externally supplied UTF-8 evidence contents.
// Hash consistency does not establish source authenticity or semantic truth.
const { readFile, stat } = require('node:fs/promises');
const { verifyCompletedMission, verifyEvidenceContents } = require('../dist/packages/proof-core/src');
async function readJson(file) {
  if ((await stat(file)).size > 10 * 1024 * 1024) throw new Error('Input exceeds 10 MiB');
  return JSON.parse(await readFile(file, 'utf8'));
}
(async () => {
  if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node scripts/verify-mission-record.cjs <mission-record.json> [evidence-content-map.json]');
  const record = await readJson(process.argv[2]);
  verifyCompletedMission(record);
  const contents = process.argv[3] ? await readJson(process.argv[3]) : {};
  const { checked } = verifyEvidenceContents(record.run.evidence, contents);
  console.log(JSON.stringify({ status: 'VERIFIED', scope: 'canonical_mission_record_integrity_and_acceptance', mission_id: record.mission.mission_id,
    execution_id: record.run.execution_id, mission_receipt_sha256: record.mission_receipt.receipt_sha256,
    evidence_content: checked ? 'CHECKED' : 'NO_CONTENT_COMMITMENTS', evidence_content_checked: checked,
    source_authenticity: 'NOT_ESTABLISHED', semantic_correctness: 'NOT_ESTABLISHED' }));
})().catch(() => { console.error(JSON.stringify({ status: 'REJECTED', code: 'MISSION_RECORD_VERIFICATION_FAILED' })); process.exitCode = 1; });
