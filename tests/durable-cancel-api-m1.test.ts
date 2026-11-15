import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionRecord } from "../packages/contracts/src";
import { FileDurableJobStore } from "../packages/durable-execution/src";
import { handleDurableRequest } from "../apps/api/src/durable";

test("TEST: queued cancellation is scoped, idempotent and rejects cross-origin requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "osa-m1-cancel-api-"));
  const store = new FileDurableJobStore(root);
  const scope = { organization_id:"org_test", project_id:"project_test", identity_id:"identity_test" };
  const input = { execution_id:`exec_${randomUUID()}`, conversation_id:randomUUID(), kind:"model", prompt:"synthetic", agent:"jeverson" };
  await store.submit(scope, input);
  const session = { identity: scope } as unknown as SessionRecord;
  const server = createServer((req,res) => { void handleDurableRequest(req,res,session,scope.project_id,{OSA_DURABLE_DIR:root}); });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/durable/jobs/${input.execution_id}/cancel`;
  try {
    assert.equal((await fetch(url,{method:"POST",headers:{origin:"https://untrusted.example"}})).status,403);
    assert.equal((await store.get(scope,input.execution_id))?.status,"QUEUED");
    const response = await fetch(url,{method:"POST"});
    assert.equal(response.status,200);
    assert.equal((await response.json() as {status:string}).status,"CANCELLED");
    assert.equal((await fetch(url,{method:"POST"})).status,200);
    assert.equal(await store.get({...scope,identity_id:"other_identity"},input.execution_id),undefined);
    assert.equal(await store.claim((await store.queued())[0]),undefined);
  } finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
});
