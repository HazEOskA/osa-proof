"use strict";
// Integration gate: REAL local NeurOSA Brain API + OSA Proof MemoryService + model
// request contract. The model transport is deliberately stubbed: no API costs,
// no production data, no Railway or Vercel modification.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { NeurosaMemoryAdapter } = require("../dist/packages/adapters/src/brain.js");
const { MemoryService } = require("../dist/apps/api/src/memory.js");
const { nvidiaComplete } = require("../dist/apps/api/src/nvidia.js");

async function main() {
  const origin = process.env.NEUROSA_E2E_BASE_URL || "http://127.0.0.1:8644";
  const token = process.env.NEUROSA_E2E_TOKEN;
  assert.ok(token && token.length >= 24, "local-only token required");
  const memory = new MemoryService(new NeurosaMemoryAdapter({
    baseUrl: origin, token, brainId: "OsaBrain",
    organizationId: "org_osa_e2e_local", projectId: "osa-proof",
  }));
  const session = {
    session_id: "osa-e2e-session",
    token: "",
    identity: {
      identity_id: "osa-e2e-operator", provider: "vercel-preview",
      subject: "local-e2e-only", display_name: "Test Operator",
      organization_id: "org_osa_e2e_local", project_ids: ["osa-proof"],
      roles: ["operator"], verified: true,
    },
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "9999-12-31T23:59:59.999Z",
  };
  const code = "FOKA-742-BURSZTYN";
  const firstConversationId = randomUUID();
  const firstStatement = "Nazwa informacji: kod kontrolny OSA. Wartość: " + code;
  const receipt = await memory.remember(session, firstConversationId, firstStatement);
  assert.ok(receipt.document_id && receipt.receipt_sha256);
  const readback = await memory.adapter.readEvent(
    memory.scope(session, "memory-receipt-read"), receipt.document_id
  );
  assert.equal(readback.receipt.receipt_sha256, receipt.receipt_sha256);
  assert.equal(readback.event.data.text, firstStatement);

  const secondConversationId = randomUUID();
  assert.notEqual(firstConversationId, secondConversationId);
  const question = [
    "W poprzedniej rozmowie zapisałem informację oznaczoną jako „kod kontrolny OSA”.",
    "Odzyskaj informację z NeurOSA i podaj wartość wraz z dokumentem źródłowym.",
    "Nie zgaduj i nie korzystaj z historii rozmowy.",
  ].join(" ");
  assert.ok(!question.includes(code));
  const context = await memory.recall(session, secondConversationId, question);
  assert.ok(context.text.includes(code), "cross-session memory was not retrieved");
  const source = context.references.find(ref => ref.documentId === receipt.document_id);
  assert.ok(source, "missing actual source reference");
  assert.equal(source.sourceCurrent, true);

  let modelRequests = 0;
  const fakeNvidia = async (_url, request) => {
    modelRequests += 1;
    const body = JSON.parse(String(request.body));
    assert.ok(body.messages.some(msg => msg.content.includes(code)), "model was not given retrieved memory");
    assert.ok(body.messages.some(msg => msg.content.includes(receipt.document_id)), "model lost memory citation");
    return Response.json({
      id:"provider-local-controlled",choices:[{message:{content:code},finish_reason:"stop"}],
    });
  };
  const answer = await nvidiaComplete(question,
    {NVIDIA_API_KEY:"test-only-fake-nvidia-key",NVIDIA_MODEL:"nvidia/nemotron-3.5-lightning-30b-a3b"},
    fakeNvidia,{agent:"jeverson",history:[],memory:context});
  assert.equal(modelRequests,1);
  assert.equal(answer.text,code);
  const evidence = await memory.recordAnswer(session,context,question,answer);
  const verified = await memory.adapter.readEvent(
    memory.scope(session,"memory-receipt-read"),evidence.receipt.document_id
  );
  assert.equal(verified.receipt.receipt_sha256,evidence.receipt.receipt_sha256);
  assert.equal(verified.event.kind,"CHAT_PROVENANCE");
  assert.equal(verified.event.data.memory.context_sha256,context.context_sha256);

  console.log(JSON.stringify({
    result:"PASS",source:"ACTUAL_LOCAL_NEUROSA_BRAIN_API",
    bridge:"OSA_PROOF_MEMORY_SERVICE",provider:"CONTROLLED_TEST_DOUBLE_NO_NVIDIA_NETWORK",
    memory_readback:true,cross_session_recall:true,source_reference:true,
    provider_context_injection:true,provenance_receipt:true,
    same_conversation:firstConversationId===secondConversationId,
    external_deploy:false,production_mutation:false,
  },null,2));
}
main().catch(error=>{
  console.error("OSA_NEUROSA_CROSS_REPO_E2E_FAILED",error.code || error.message);
  process.exitCode=1;
});
