#!/usr/bin/env node
// Read-only local diagnostic. A lock may belong to a live process: never remove it here.
const { lstat } = require('node:fs/promises');
const { join } = require('node:path');
const { FileMissionStore } = require('../dist/packages/runtime/src');
const { digest, verifyCompletedMission } = require('../dist/packages/proof-core/src');
(async () => {
  if (process.argv.length !== 4) throw Error('Usage: node scripts/inspect-mission-store.cjs <directory> <mission-id>');
  const [, , directory, id] = process.argv;
  if (!id.trim()) throw Error('Mission id is required');
  let locked = false;
  try { await lstat(join(directory, `${digest(id)}.json.lock`)); locked = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const record = await new FileMissionStore(directory).get(id);
  let assessment;
  if (locked) assessment = 'LOCK_PRESENT_MANUAL_REVIEW';
  else if (!record) assessment = 'NOT_FOUND';
  else if (record.planning?.status === 'RUNNING' || ['EXECUTING', 'VERIFYING'].includes(record.state)) assessment = 'ACTIVE_REQUIRES_RECONCILIATION';
  else if (record.state === 'COMPLETED') { verifyCompletedMission(record); assessment = 'COMPLETED_INTEGRITY_CHECKED'; }
  else assessment = 'INACTIVE_REVIEW_STATE';
  // Lock and snapshot were observed at different instants; this is not a lease or a safe unlock decision.
  console.log(JSON.stringify({ schema:'osa.mission_store_diagnostic.v1', assessment, lock_present:locked,
    mission_id:id, state:record?.state ?? null, revision:record?.revision ?? null,
    planning_status:record?.planning?.status ?? null, read_only:true, observation_not_atomic:true }));
})().catch(() => { console.error(JSON.stringify({ assessment:'DIAGNOSTIC_FAILED', code:'STORE_INSPECTION_FAILED' })); process.exitCode=1; });
