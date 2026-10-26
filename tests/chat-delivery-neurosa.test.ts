import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { type AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { ChatDelivery } from "../apps/api/src/chat-delivery";
import { createDevFixtureRegistry } from "../apps/api/src/server";
import { BrainControlPlane } from "../packages/brain/src";
import { verifyMemoryEvent } from "../packages/brain/src/memory";
import type { BrainScope, Identity, MemoryEvent, MemoryWriteReceipt, WritableBrainMemory } from "../packages/contracts/src";
import { digest, sha256Hex, canonicalJson } from "../packages/proof-core/src/canonical";

const binding={organization_id:"org-osa",project_id:"project-neurosa"};
const identity:Identity={
  identity_id:"github_123",provider:"github",subject:"123",display_name:"OSA test",
  organization_id:binding.organization_id,project_ids:[binding.project_id],roles:["operator"],verified:true
};
const html='<!doctype html><html lang="pl"><head><title>OSA</title></head><body><p>Działa</p></body></html>';
type Stored={event:MemoryEvent;receipt:MemoryWriteReceipt};
function localContract() {
  const events:Stored[]=[];
  const calls:string[]=[];
  let writeFails=false;
  const adapter:WritableBrainMemory={
    id:"test-memory-only",binding,
    async probe(scope:BrainScope) {
      calls.push("probe");assert.equal(scope.project_id,binding.project_id);
      return {brain_id:"OsaBrain",ledger_valid:true as const};
    },
    async recall(scope:BrainScope) {
      calls.push("recall");assert.equal(scope.organization_id,binding.organization_id);
      const body={scope:structuredClone(scope),brain_id:"OsaBrain",ledger_head:"ledger-test",
        text:"Projekt OSA ma własną pamięć.",references:[],truncated:false};
      return {...body,context_sha256:digest(body)};
    },
    async observe(event:MemoryEvent) {
      calls.push("observe:"+event.kind);
      verifyMemoryEvent(event);
      if(writeFails)throw Error("SYNTHETIC_UPSTREAM_ERROR_DO_NOT_DISCLOSE");
      const body={schema:"osa.memory_write_receipt.v1" as const,scope:event.scope,brain_id:"OsaBrain",
        event_sha256:event.event_sha256,document_id:"doc_"+randomUUID().replace(/-/g,""),document_revision:1,
        content_sha256:sha256Hex(canonicalJson(event))};
      const receipt={...body,receipt_sha256:digest(body)};
      events.push({event,receipt});return receipt;
    },
    async readEvent(scope:BrainScope,documentId:string) {
      const item=events.find(e=>e.receipt.document_id===documentId);
      if(!item||scope.organization_id!==binding.organization_id||scope.project_id!==binding.project_id)throw Error("UNAVAILABLE");
      return item;
    }
  };
  return {adapter,events,calls,failWrites:()=>{writeFails=true;}};
}
type Frame={type:string;data:any};
function frames(s:string):Frame[]{
  return s.split("\n\n").filter(f=>f.startsWith("event: ")).map(f=>({
    type:f.split("\n")[0].slice(7),
    data:JSON.parse(f.split("\n").find(x=>x.startsWith("data: "))!.slice(6))
  }));
}
async function context() {
  const memory=localContract(),state=new ApiState(undefined,undefined,undefined,"session",undefined,
    new BrainControlPlane(undefined,memory.adapter));
  let calls=0;
  state.delivery=new ChatDelivery(async()=>{
    calls++;return {content:html,evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_CONTRACT_TEST"}}]};
  });
  const session=state.sessions.create(identity);
  const srv=createApiServer(createDevFixtureRegistry(),state);
  await new Promise<void>(resolve=>srv.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+(srv.address() as AddressInfo).port;
  const post=(token:string,remember:boolean)=>fetch(base+"/chat/delivery",{
    method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify({prompt:"Zbuduj stronę",kind:"webapp",execution_id:"exec_"+randomUUID(),
      conversation_id:randomUUID(),remember})
  });
  return {memory,state,session,post,calls:()=>calls,close:async()=>{srv.closeAllConnections();await new Promise<void>(resolve=>srv.close(()=>resolve()));}};
}
test("Artefakt: brak uprawnień NeurOSA blokuje model przed wykonaniem",async()=>{
  const t=await context();try {
    for(const change of [{organization_id:"foreign"},{project_ids:["foreign"]},{provider:"local-dev" as const}]) {
      const wrong=t.state.sessions.create({...identity,...change});
      const res=await t.post(wrong.token,true);
      assert.ok([401,403].includes(res.status),String(res.status));
    }
    assert.equal(t.calls(),0);assert.deepEqual(t.memory.calls,[]);
  }finally{await t.close();}
});
test("Artefakt: opt-in write, recall, weryfikacja wykonania i jawny memory receipt",async()=>{
  const t=await context();try {
    const res=await t.post(t.session.token,true);
    assert.equal(res.status,200);
    const f=frames(await res.text());
    const bundle=f.find(x=>x.type==="complete")?.data;
    assert.equal(bundle?.status,"EXECUTED");
    assert.equal(bundle.memory_status,"VERIFIED");
    assert.equal(bundle.team.project_id,binding.project_id);
    assert.equal(bundle.mission.project_id,binding.project_id);
    assert.ok(bundle.memory_context_sha256);
    assert.equal(t.calls(),1);
    assert.deepEqual(t.memory.events.map(x=>x.event.kind),["AUTHENTICATED_USER_STATEMENT","VERIFIED_RUNTIME"]);
    assert.equal(bundle.memory_write.receipt_sha256,t.memory.events[1].receipt.receipt_sha256);
    assert.ok(t.memory.calls.indexOf("recall")<t.memory.calls.indexOf("observe:VERIFIED_RUNTIME"));
    assert.ok(f.some(x=>x.type==="memory_verified"));
  }finally{await t.close();}
});
test("Artefakt: awaria zapisu po zweryfikowaniu nie tworzy fałszywego PASS pamięci",async()=>{
  const t=await context();try {
    t.memory.failWrites();
    const res=await t.post(t.session.token,false);
    assert.equal(res.status,200);
    const f=frames(await res.text()),bundle=f.find(x=>x.type==="complete")?.data;
    assert.equal(bundle?.status,"EXECUTED");assert.ok(bundle.artifact);
    assert.equal(bundle.memory_status,"UNAVAILABLE");
    assert.equal(bundle.memory_write,undefined);
    assert.ok(f.some(x=>x.type==="memory_error"));
    assert.equal(t.calls(),1);
    assert.doesNotMatch(JSON.stringify(f),/SYNTHETIC_UPSTREAM_ERROR_DO_NOT_DISCLOSE/);
  }finally{await t.close();}
});
