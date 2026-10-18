import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ApiState, createApiServer } from "../apps/api/src";
import { MemoryService } from "../apps/api/src/memory";
import { PreviewOperator } from "../apps/api/src/preview-operator";
import { BrainControlPlane } from "../packages/brain/src";
import { sealMemoryEvent, verifyMemoryEvent } from "../packages/brain/src/memory";
import type { BrainMemoryContext, MemoryEvent, WritableBrainMemory } from "../packages/contracts/src";
import { digest } from "../packages/proof-core/src/canonical";
import { ExecutorRegistry } from "../packages/runtime/src";
import type { AddressInfo } from "node:net";

const binding = { organization_id: "org_dev_local", project_id: "osa-proof" };
const operatorEnv = { OSA_PREVIEW_SINGLE_OPERATOR: "enabled", VERCEL: "1", VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/neurosa-chat-memory", VERCEL_GIT_REPO_OWNER: "HazEOskA",
  VERCEL_GIT_REPO_SLUG: "osa-proof", OSA_NEUROSA_ORGANIZATION_ID: binding.organization_id,
  OSA_NEUROSA_PROJECT_ID: binding.project_id };

function fixture() {
  const documents = new Map<string, MemoryEvent>();
  let writes = 0, recalled = 0;
  const adapter: WritableBrainMemory = {
    id: "diagnostic-test-memory", binding,
    async probe() { return { brain_id: "OsaBrain", ledger_valid: true }; },
    async observe(event) {
      verifyMemoryEvent(event);
      assert.equal(event.kind, "DIAGNOSTIC_TEST");
      assert.deepEqual({ organization_id: event.scope.organization_id, project_id: event.scope.project_id }, binding);
      const previous = documents.get(event.event_sha256);
      if (!previous) { documents.set(event.event_sha256, event); writes++; }
      const body = { schema: "osa.memory_write_receipt.v1" as const, scope: event.scope, brain_id: "OsaBrain",
        event_sha256: event.event_sha256, document_id: "doc_" + event.event_sha256.slice(0,32),
        document_revision: 1, content_sha256: digest(event) };
      return { ...body, receipt_sha256: digest(body) };
    },
    async readEvent(scope, documentId) {
      const event = [...documents.values()].find(item => "doc_" + item.event_sha256.slice(0,32) === documentId);
      if (!event) throw Error("Missing document");
      assert.equal(event.scope.organization_id, scope.organization_id);
      const body = { schema: "osa.memory_write_receipt.v1" as const, scope: event.scope,
        brain_id: "OsaBrain", event_sha256: event.event_sha256, document_id: documentId,
        document_revision: 1, content_sha256: digest(event) };
      return { event, receipt: { ...body, receipt_sha256: digest(body) } };
    },
    async recall(scope, query, maxChars) {
      recalled++;
      const event = [...documents.values()].find(item => item.data.statement === query);
      const body = { scope, brain_id: "OsaBrain", ledger_head: createHash("sha256").update("fixture").digest("hex"),
        text: event ? String(event.data.statement).slice(0,maxChars) : "",
        references: event ? [{ documentId: "doc_" + event.event_sha256.slice(0,32), revision: 1 }] : [],
        truncated: false };
      return { ...body, context_sha256: digest(body) } satisfies BrainMemoryContext;
    },
  };
  return { adapter, get writes() {return writes;}, get recalled(){return recalled;} };
}

test("operator diagnostic: one synthetic record, idempotent retry, verified read and cross-session recall", async () => {
  const f=fixture(), service=new MemoryService(f.adapter), session=PreviewOperator.fromEnvironment(operatorEnv)!.session;
  const result=await service.diagnostic(session);
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.assurance, "LIVE_MEMORY_IO_INTEGRITY");
  assert.equal(result.persistence_verified, false);
  assert.equal(result.external_attestation_verified, false);
  assert.equal(f.writes, 1);
  assert.equal(f.recalled, 1);
  assert.equal(result.checks.length, 6);
});

test("diagnostic event: changed nonce, statement or kind is refused", () => {
  const scope={...binding,mission_id:"diagnostic_x"};
  const event=sealMemoryEvent({scope,kind:"DIAGNOSTIC_TEST",verification_scope:"synthetic",
    data:{run_kind:"NEUROSA_LIVE_E2E_V1",nonce:"a".repeat(32),statement:"NEUROSA_DIAGNOSTIC_"+"a".repeat(32)}});
  verifyMemoryEvent(event);
  for(const data of [{...event.data,statement:"changed"},{...event.data,nonce:"Z".repeat(32)},{...event.data,additional:true}]){
    assert.throws(()=>verifyMemoryEvent(sealMemoryEvent({...event,data})),/MEMORY_EVENT_REJECTED/);
  }
});

test("operator diagnostic HTTP: reject cross origin and non-operator, avoid model execution", async () => {
  const fixtureMemory=fixture(), operator=PreviewOperator.fromEnvironment(operatorEnv)!;
  const state=new ApiState(undefined,undefined,undefined,"open",undefined,
    new BrainControlPlane(undefined,fixtureMemory.adapter),undefined,operator);
  const server=createApiServer(new ExecutorRegistry(),state);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const url="http://127.0.0.1:"+(server.address() as AddressInfo).port+"/memory/diagnostic";
    const denied=await fetch(url,{method:"POST",body:"{}",headers:{origin:"https://evil.test",host:"preview.test"}});
    assert.equal(denied.status,403);
    assert.equal(fixtureMemory.writes,0);
    const accepted=await fetch(url,{method:"POST",body:"{}",headers:{origin:"https://"+new URL(url).host,"sec-fetch-site":"same-origin"}});
    assert.equal(accepted.status,200);
    assert.equal((await accepted.json() as {status:string}).status,"VERIFIED");
    assert.equal(fixtureMemory.writes,1);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
  const noOperatorState=new ApiState(undefined,undefined,undefined,"open",undefined,
    new BrainControlPlane(undefined,fixtureMemory.adapter));
  const otherServer=createApiServer(new ExecutorRegistry(),noOperatorState);
  await new Promise<void>(resolve=>otherServer.listen(0,"127.0.0.1",resolve));
  try {
    const url="http://127.0.0.1:"+(otherServer.address() as AddressInfo).port+"/memory/diagnostic";
    const response=await fetch(url,{method:"POST",body:"{}"});
    assert.notEqual(response.status,200);
  } finally {await new Promise<void>(resolve=>otherServer.close(()=>resolve()));}
});
