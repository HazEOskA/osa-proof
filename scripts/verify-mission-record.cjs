#!/usr/bin/env node
// Verify a saved osa.mission.v1 record with the canonical core verifier.
// Hash consistency does not establish source authenticity or semantic truth.
const { readFile, stat } = require('node:fs/promises');
const { verifyCompletedMission } = require('../dist/packages/proof-core/src');
(async () => {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/verify-mission-record.cjs <mission-record.json>');
  const file = process.argv[2];
  if ((await stat(file)).size > 10 * 1024 * 1024) throw new Error('Mission record exceeds 10 MiB');
  const record = JSON.parse(await readFile(file, 'utf8'));
  verifyCompletedMission(record);
  console.log(JSON.stringify({ status: 'VERIFIED', scope: 'canonical_mission_record_integrity_and_acceptance', mission_id: record.mission.mission_id,
    execution_id: record.run.execution_id, mission_receipt_sha256: record.mission_receipt.receipt_sha256,
    source_authenticity: 'NOT_ESTABLISHED', semantic_correctness: 'NOT_ESTABLISHED' }));
})().catch(() => { console.error(JSON.stringify({ status: 'REJECTED', code: 'MISSION_RECORD_VERIFICATION_FAILED' })); process.exitCode = 1; });
