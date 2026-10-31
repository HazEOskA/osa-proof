import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";
import { BrainControlPlane } from "../packages/brain/src";
import { ExecutorRegistry } from "../packages/runtime/src";

test("guide passes authorized NeurOSA content to NVIDIA without writing memory", async () => {
  const remoteCalls: string[] = [];
  let failRecall = false;
  const adapter = new NeurosaMemoryAdapter({
    baseUrl: "https://memory.example", token: "test-memory-token-".repeat(3),
    brainId: "OsaBrain", organizationId: "org-test", projectId: "osa-proof",
    fetch: async (url) => {
      const path = new URL(String(url)).pathname;
      remoteCalls.push(path);
      if (path.endsWith("/status")) return Response.json({brainId:"OsaBrain",ledgerValid:true});
      if (path.endsWith("/recall")) {
        if (failRecall) throw new Error("temporary failure");
        return Response.json({brainId:"OsaBrain",ledgerValid:true,ledgerHead:"test-ledger",
          text:"Źródło: fikcyjny projekt nazywa się Bursztyn.",
          references:[{documentId:"synthetic-document",revision:1}],truncated:false});
      }
      throw new Error("guide must not write memory");
    },
  });
  const state = new ApiState(undefined, undefined, undefined, "open", undefined, new BrainControlPlane(undefined, adapter));
  const user = state.sessions.create({identity_id:"test-member",provider:"microsoft",subject:"test-member",
    display_name:"Test",organization_id:"org-test",project_ids:["osa-proof"],roles:[],verified:true});
  const foreign = state.sessions.create({identity_id:"other-member",provider:"microsoft",subject:"other-member",
    display_name:"Other",organization_id:"other",project_ids:["osa-proof"],roles:[],verified:true});
  const server = createApiServer(new ExecutorRegistry(), state);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const previousFetch = globalThis.fetch, previousKey = process.env.NVIDIA_API_KEY,
    previousCost = process.env.OSA_ZERO_COST_ONLY;
  process.env.NVIDIA_API_KEY = "unit-test-provider";
  process.env.OSA_ZERO_COST_ONLY = "false";
  let providerCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== "https://integrate.api.nvidia.com/v1/chat/completions") return previousFetch(url, init);
    providerCalls++;
    const request = JSON.parse(String(init?.body));
    if (!failRecall) {
      assert.match(request.messages[1].content, /Bursztyn/);
      assert.match(request.messages[1].content, /synthetic-document/);
    } else assert.equal(request.messages.length, 2);
    return Response.json({id:"provider-response",model:"nvidia/test-resolved",
      choices:[{message:{content:"Bursztyn"},finish_reason:"stop"}]});
  };
  const post = (token: string | undefined, body: object) => fetch(base+"/nvidia/fleet-chat", {
    method:"POST",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},
    body:JSON.stringify(body),
  });
  try {
    const request = {prompt:"Jak nazywa się projekt?",agent:"guide",view:"home",history:[]};
    assert.equal((await post(undefined,request)).status,401);
    assert.equal((await post(foreign.token,request)).status,403);
    assert.equal(remoteCalls.length,0);
    assert.equal((await post(user.token,{...request,remember:true})).status,403);
    const response = await post(user.token,request); // Legacy guide without conversation_id remains compatible.
    assert.equal(response.status,200);
    const answer = await response.json() as {status:string;provider_model?:string;memory_context?:{references:unknown[]}};
    assert.equal(answer.status,"PROVIDER_RESPONSE");
    assert.equal(answer.provider_model,"nvidia/test-resolved");
    assert.equal(answer.memory_context?.references.length,1);
    assert.deepEqual(remoteCalls,["/api/v1/brain/status","/api/v1/brain/recall"]);
    failRecall=true;
    const degraded=await post(user.token,request);
    assert.equal(degraded.status,200);
    const degradedAnswer=await degraded.json() as {memory_status?:string;memory_context?:unknown};
    assert.equal(degradedAnswer.memory_status,"UNAVAILABLE");
    assert.equal(degradedAnswer.memory_context,undefined);
    assert.equal(providerCalls,2);
    assert.ok(!remoteCalls.some(path=>path.endsWith("/remember")||path.endsWith("/observe")));
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=previousKey;
    if(previousCost===undefined)delete process.env.OSA_ZERO_COST_ONLY;else process.env.OSA_ZERO_COST_ONLY=previousCost;
  }
});
