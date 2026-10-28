// Isolated integration test. Requires the checked-out NeurOSA source and its dependencies.
// This harness injects test identities and two read-only local executors; it is not browser or production E2E.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { ApiState, createApiServer } = require('../dist/apps/api/src');
const { NeurosaMemoryAdapter } = require('../dist/packages/adapters/src');
const { BrainControlPlane, NativeBrainPlanner } = require('../dist/packages/brain/src');
const { sealMemoryEvent } = require('../dist/packages/brain/src/memory');
const { ExecutorRegistry, FileMissionStore } = require('../dist/packages/runtime/src');
const { verifyCompletedMission, digest } = require('../dist/packages/proof-core/src');

const neurosaDir = process.env.NEUROSA_CHECKOUT;
if (!neurosaDir) throw new Error('Set NEUROSA_CHECKOUT to a local NeurOSA checkout');
const token = `test-only-${randomUUID()}-${randomUUID()}`;
const missionId = `OSA-ULTIMATE-001-${randomUUID()}`;
const scope = { organization_id: 'synthetic_org', project_id: 'synthetic_project', mission_id: missionId };
const marker = `OSASYNTHETIC${randomUUID().replaceAll('-', '')}`;
const root = resolve(__dirname, '..');
let brain, api, directory;
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function startBrain() {
  let output = '';
  const proc = spawn(process.execPath, ['--import', 'tsx', 'apps/brain-api/src/server.ts'], {
    cwd: neurosaDir, env: { ...process.env, NEUROSA_API_TOKEN: token, NEUROSA_API_SCOPES: 'brain:read,memory:read,memory:write',
      NEUROSA_DATABASE_PATH: join(directory, 'brain.db'), NEUROSA_API_HOST: '127.0.0.1', NEUROSA_API_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', data => { output += data; }); proc.stderr.on('data', data => { output += data; });
  for (let i = 0; i < 150; i++) {
    const match = output.match(/nasłuchuje: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) return { proc, base: match[1] };
    if (proc.exitCode !== null) throw new Error('Brain API exited before ready: ' + output.slice(-1000));
    await sleep(100);
  }
  proc.kill('SIGTERM'); throw new Error('Brain API startup timeout');
}
async function stopBrain() {
  if (!brain || brain.proc.exitCode !== null) return;
  const exited = new Promise(resolve => brain.proc.once('exit', resolve)); brain.proc.kill('SIGTERM'); await exited;
}
function adapter(base) { return new NeurosaMemoryAdapter({ baseUrl: base, token, brainId: 'OsaBrain', organizationId: scope.organization_id, projectId: scope.project_id }); }
async function startApi(memory, registry) {
  const state = new ApiState(undefined, undefined, undefined, 'session', new FileMissionStore(join(directory, 'missions')), new BrainControlPlane(new NativeBrainPlanner(), memory));
  const server = createApiServer(registry, state); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const identity = org => ({ identity_id: `synthetic-${org}`, provider: 'microsoft', subject: `test:${org}`, display_name: 'test only', verified: true, roles: [], organization_id: org, project_ids: [scope.project_id] });
  const session = state.sessions.create(identity(scope.organization_id));
  const foreign = state.sessions.create(identity('foreign_org'));
  const wrongProject = state.sessions.create({ ...identity(scope.organization_id), identity_id: 'wrong-project', project_ids: ['foreign_project'] });
  return { server, base: `http://127.0.0.1:${server.address().port}`, headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` }, foreign: { authorization: `Bearer ${foreign.token}` }, wrongProject: { authorization: `Bearer ${wrongProject.token}` } };
}
async function closeApi() { if (api) { await new Promise((resolve, reject) => api.server.close(e => e ? reject(e) : resolve())); api = undefined; } }
async function main() {
  directory = await mkdtemp(join(tmpdir(), 'osa-final-boss-'));
  brain = await startBrain(); let memory = adapter(brain.base);
  const event = sealMemoryEvent({ scope, kind: 'AUTHENTICATED_USER_STATEMENT', verification_scope: 'synthetic_local_test', data: { text: `${marker} verify repository evidence` } });
  const written = await memory.observe(event);
  assert.deepEqual((await memory.readEvent(scope, written.document_id)).receipt, written);
  assert.deepEqual(await memory.observe(event), written); // idempotent write
  await assert.rejects(memory.recall({ ...scope, organization_id: 'foreign_org' }, marker, 4000), /SCOPE_DENIED/);
  const denied = await fetch(`${brain.base}/api/v1/brain/status`); assert.equal(denied.status, 401);
  await stopBrain(); brain = await startBrain(); memory = adapter(brain.base);
  const recovered = await memory.readEvent(scope, written.document_id); assert.deepEqual(recovered.receipt, written);
  const recall = await memory.recall(scope, marker, 4000); assert.match(recall.text, new RegExp(marker));
  assert.ok(recall.references.some(ref => ref.documentId === written.document_id && ref.contentHash === written.content_sha256));
  const wrongBrain = new NeurosaMemoryAdapter({ baseUrl: brain.base, token, brainId: 'wrong-brain', organizationId: scope.organization_id, projectId: scope.project_id });
  await assert.rejects(wrongBrain.recall(scope, marker, 4000), /NEUROSA_/);
  const registry = new ExecutorRegistry(); let executions = 0;
  for (const [ref, file] of [['audit.readme', 'README.md'], ['audit.package', 'package.json']]) {
    registry.register(ref, async ({ input }) => {
      executions++; const content = await readFile(join(root, file));
      const result = { file, size: content.length, sha256: createHash('sha256').update(content).digest('hex'), read: true };
      return { output: { previous: input, result }, evidence: [{ kind: 'repository_read', data: result }] };
    });
  }
  api = await startApi(memory, registry);
  const graph = { organization_id: scope.organization_id, project_id: scope.project_id, team_id: 'synthetic-team', version: '1',
    agents: [{ agent_id: 'reader1', role: 'repository reader', executor_ref: 'audit.readme' }, { agent_id: 'reader2', role: 'repository reader', executor_ref: 'audit.package' }],
    edges: [{ edge_id: 'handoff', from_agent_id: 'reader1', to_agent_id: 'reader2', kind: 'handoff' }] };
  const mission = { ...scope, team_id: graph.team_id, team_version: graph.version, entry_agent_id: 'reader1', objective: marker,
    input: { allowed_files: ['README.md', 'package.json'] }, budget: { max_tasks: 2, max_context_chars: 4000 }, policy: { allowed_executor_refs: ['audit.readme', 'audit.package'] },
    requirements: ['reader1', 'reader2'].map(agent_id => ({ requirement_id: `read-${agent_id}`, type: 'evidence_field_equals', agent_id, evidence_kind: 'repository_read', field: 'read', expected: true })) };
  const post = (path, body) => fetch(api.base + path, { method: 'POST', headers: api.headers, body: JSON.stringify(body) });
  assert.equal((await post('/teams', graph)).status, 201); assert.equal((await post('/missions', mission)).status, 201);
  assert.equal((await fetch(api.base + `/missions/${missionId}`, { headers: api.foreign })).status, 403);
  assert.equal((await fetch(api.base + `/missions/${missionId}`, { headers: api.wrongProject })).status, 403);
  assert.equal((await fetch(api.base + `/missions/${missionId}`)).status, 401);
  const response = await post(`/missions/${missionId}/run`, {}); assert.equal(response.status, 201, await response.text());
  let record = await (await fetch(api.base + `/missions/${missionId}`, { headers: api.headers })).json(); verifyCompletedMission(record);
  assert.equal(record.run.verdict, 'VERIFIED'); assert.equal(executions, 2);
  assert.match(record.brain.memory.text, new RegExp(marker));
  assert.equal(record.brain.planning_receipt.memory_context_sha256, record.brain.memory.context_sha256);
  assert.equal(record.brain.reflection.scope.mission_id, missionId);
  const tampered = structuredClone(record); tampered.run.evidence[0].data.sha256 = '0'.repeat(64);
  assert.throws(() => verifyCompletedMission(tampered), /rejected/);
  const missing = structuredClone(record); missing.run.evidence.pop(); assert.throws(() => verifyCompletedMission(missing), /rejected/);
  await closeApi(); await stopBrain(); brain = await startBrain(); memory = adapter(brain.base); api = await startApi(memory, registry);
  record = await (await fetch(api.base + `/missions/${missionId}`, { headers: api.headers })).json(); verifyCompletedMission(record);
  assert.equal((await post(`/missions/${missionId}/run`, {})).status, 201); assert.equal(executions, 2);
  assert.equal((await memory.readEvent(scope, written.document_id)).receipt.receipt_sha256, written.receipt_sha256);
  const folder = join(root, 'docs/final-boss/evidence');
  const recordText = JSON.stringify(record, null, 2) + '\n';
  await writeFile(join(folder, 'local-live-neurosa-mission.json'), recordText);
  const summary = { schema: 'osa.final-boss.local-integration.v1', mission_id: missionId, run_id: record.run.run_id, execution_id: record.run.execution_id,
    mission_receipt_sha256: record.mission_receipt.receipt_sha256, proof_receipt_sha256: record.run.proof.receipt_sha256,
    memory_receipt_sha256: written.receipt_sha256, memory_event_sha256: event.event_sha256, memory_document_id: written.document_id,
    memory_context_sha256: record.brain.memory.context_sha256, record_sha256: createHash('sha256').update(recordText).digest('hex'),
    events: record.timeline.length, evidence: record.run.evidence.length, worker_execution_count: executions,
    checks: ['real_neurosa_http','synthetic_remember_readback_restart_recall_provenance','scope_denial','anonymous_denial','foreign_organization_and_project_denial_with_memory_enabled','two_read_only_test_executors_sequential','mission_api_and_file_store_restart','independent_verifier','tamper_and_missing_evidence_denial','repeat_no_reexecution'],
    limitations: ['test_identity_injected','test_executors_not_sandboxed','no_browser','no_production','no_source_authenticity_attestation','no_concurrent_workers'] };
  await writeFile(join(folder, 'local-live-neurosa.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await closeApi(); await stopBrain(); if (directory) await rm(directory, { recursive: true, force: true }); });
