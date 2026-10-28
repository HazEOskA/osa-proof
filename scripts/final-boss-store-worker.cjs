// Child-process fixture for FileMissionStore concurrency and crash tests.
const { appendFile } = require('node:fs/promises');
const { FileMissionStore, MissionKernel, ExecutorRegistry } = require('../dist/packages/runtime/src');
process.on('message', async message => {
  const registry = new ExecutorRegistry();
  registry.register('reader', async () => {
    await appendFile(message.log, 'effect\n');
    if (message.hold) { process.send?.({ type: 'effect' }); await new Promise(() => {}); }
    return { output: { read: true }, evidence: [{ kind: 'read', data: { ok: true } }] };
  });
  try {
    const result = await new MissionKernel(new FileMissionStore(message.directory)).execute(message.missionId, registry);
    process.send?.({ type: 'done', verdict: result.verdict }, () => process.exit(0));
  } catch (error) {
    process.send?.({ type: 'rejected', message: error instanceof Error ? error.message : String(error) }, () => process.exit(0));
  }
});
process.send?.({ type: 'ready' });
