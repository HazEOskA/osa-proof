import test from "node:test";
import assert from "node:assert/strict";
import { WEB3_ENTITY_TYPES, WEB3_EVENT_TYPES } from "../packages/contracts/src";
import { normalizeEntity, normalizeEvent, deduplicateEvents, toOSAEvent, createIntent, cancelIntent, intentDigest, Web3EventBus } from "../packages/web3/src";
const scope = { organization_id:"org_dev_local",project_id:"project_web3_local",mission_id:"web3_test" };
const chain = {id:"solana",network:"devnet"};const now = "2026-09-30T00:00:00.000Z";
test("all 14 entity types normalize, preserve scope, isolate chains and own cloned metadata",()=>{
  for(const type of WEB3_ENTITY_TYPES){const input={type,chain,identifier:"address",metadata:{amount:"12"},createdAt:now,tags:["read","read"]};const e=normalizeEntity(input,scope);input.metadata.amount="999";assert.equal(e.metadata.amount,"12");assert.equal(e.tags.length,1);assert.deepEqual(e.context,scope);assert.equal(e.id,normalizeEntity({...input,metadata:{amount:"12"}},scope).id);assert.notEqual(e.id,normalizeEntity({...input,chain:{id:"solana",network:"mainnet"}},scope).id);}
  assert.throws(()=>normalizeEntity({type:"Invented",chain,identifier:"x",createdAt:now},scope));
  assert.throws(()=>normalizeEntity({type:"Wallet",chain,identifier:"x",createdAt:now,metadata:{nested:{privateKey:"forbidden"}}},scope),/SECRET/);
});
test("all 23 event types normalize; chain duplicates deduplicate across polling and link OSA scope",()=>{
  for(const eventType of WEB3_EVENT_TYPES){const e=normalizeEvent({eventType,chain,transactionRef:"sig",timestamp:now,confidence:"RPC_VALIDATED",source:"rpc",payload:{instructionIndex:0}},scope);const later=normalizeEvent({...e,timestamp:"2026-09-30T00:01:00.000Z"},scope);assert.equal(e.eventId,later.eventId);assert.equal(deduplicateEvents([e,later]).length,1);assert.equal(toOSAEvent(e,"execution").mission_id,scope.mission_id);}
  assert.throws(()=>normalizeEvent({eventType:"FAKE",chain,timestamp:now},scope));
  assert.throws(()=>normalizeEvent({eventType:"TOKEN_TRANSFERRED",chain,timestamp:now,confidence:"RPC_VALIDATED",source:"rpc",slot:-1},scope));
});
test("intent ignores client-granted statuses, policy and simulation; enforces integer base units",()=>{
  const input={intentId:"i",agentId:"a",chain,action:"transfer",sourceEntity:"from",targetEntity:"to",asset:"SOL",amount:"1",parameters:{program:"p"},reason:"test",riskLevel:"LOW",createdAt:now,status:"CONFIRMED",simulationResult:{success:true},requiresApproval:false};
  const intent=createIntent(input,scope);assert.equal(intent.status,"CREATED");assert.equal(intent.requiresApproval,true);assert.equal(intent.simulationResult,null);assert.equal(cancelIntent(intent).status,"CANCELLED");assert.throws(()=>createIntent({...input,amount:"1.2"},scope));assert.throws(()=>createIntent({...input,amount:"-1"},scope));assert.notEqual(intentDigest(intent),intentDigest({...intent,amount:"2"}));
});

test("normalized event dispatcher uses OSA envelopes, scoped delivery, duplicate suppression and replay",()=>{
 const event=normalizeEvent({eventType:"TRANSACTION_CONFIRMED",chain,transactionRef:"sig",timestamp:now,confidence:"RPC_VALIDATED",source:"rpc",proofRef:"core_evidence"},scope);
 const bus=new Web3EventBus();let delivered=0;let foreign=0;const unsubscribe=bus.subscribe(scope,e=>{delivered++;assert.equal(e.event_type,"WEB3.TRANSACTION_CONFIRMED");assert.deepEqual(e.evidence,["core_evidence"]);});bus.subscribe({...scope,organization_id:"foreign"},()=>foreign++);
 assert.equal(bus.publish(event,"exec").duplicate,false);assert.equal(bus.publish(event,"exec").duplicate,true);assert.equal(bus.replay([event,event],"exec").length,1);assert.equal(delivered,1);assert.equal(foreign,0);unsubscribe();const fresh=new Web3EventBus();assert.equal(fresh.replay([event],"exec")[0].envelope.event_id,event.eventId);
});
