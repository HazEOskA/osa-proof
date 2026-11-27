import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nvidiaComplete } from "../apps/api/src/nvidia";
import { executeDurableJob, runDurableWorkerOnce } from "../apps/worker/src/durable-executor";
import { FileDurableJobStore } from "../packages/durable-execution/src";
import { FleetQueue } from "../packages/fleet/src";
import { verifyProofReceipt } from "../packages/proof-core/src";
import type { RunResult } from "../packages/contracts/src";
import { createAgentIdentityV1, createAgentKeyPair, signerFromPrivateKey } from "../packages/identity/src/agent-crypto";
import { createDelegationV1, verifyActionReceiptV1, verifyRuntimeAttestationV1 } from "../packages/runtime/src/trust";
import { verifyMerkleProofV1 } from "../packages/proof-core/src";
import { registryCommitInstruction, verifyRegistryCommitment } from "../packages/web3/src/solana/proof-registry";

// The isolated test directories are deliberately left in place; no user data
// or generated files are deleted by this test.
const scope={organization_id:"org_fixture",project_id:"project_fixture",identity_id:"identity_fixture"};
const input=()=>({execution_id:"exec_"+randomUUID(),conversation_id:randomUUID(),kind:"model",prompt:"Ile to 2+2?",agent:"jeverson"});
const reply=(text:string)=>({provider:"NVIDIA",model:"fixture",text,request_id:"fixture",request_sha256:"a".repeat(64),
  provider_response_id:"fixture",latency_ms:1,http_status:200,finish_reason:"stop",status:"PROVIDER_RESPONSE"});

test("TEST: Durable chat seals the scoped result and rejects forged registry evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "osa-trust-fixture-"));
  const store = new FileDurableJobStore(root);
  const body = input();
  const controller = createAgentKeyPair();
  const agent = createAgentKeyPair();
  const build_digest = "a".repeat(64);
  const policy_digest = "b".repeat(64);
  const identity = createAgentIdentityV1({
    ai_id: "@ai:osa.test/jeverson", controller: "@ai:osa.test", agent_id: "jeverson",
    created_at: new Date().toISOString(), public_key_pem: agent.public_key_pem, key_id: agent.key_id,
  });
  function credentials(expires: number) {
    const delegation = createDelegationV1({
      principal: identity.controller, agent_ai_id: identity.ai_id, policy_digest,
      scopes: ["durable:chat"], max_cost: 0,
      valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: new Date(Date.now() + expires).toISOString(),
    }, signerFromPrivateKey(controller.private_key_pem, controller.key_id));
    return JSON.stringify({ scope, identity, delegation, build_digest, policy_digest,
      controller_public_key_pem: controller.public_key_pem, private_key_pem: agent.private_key_pem });
  }
  const model = (async () => reply("2+2=4")) as typeof nvidiaComplete;
  await store.submit(scope, body);
  await runDurableWorkerOnce(store, {model, env: {OSA_DURABLE_CHAT_TRUST: credentials(60_000)}});
  const job = await new FileDurableJobStore(root).get(scope, body.execution_id);
  assert.equal(job?.status, "COMPLETED");
  const result = job.result as Awaited<ReturnType<typeof executeDurableJob>>;
  const trust = result.audit?.signed_trust;
  assert.ok(trust);
  assert.equal(trust.anchor_status, "NOT_ANCHORED");
  assert.equal(trust.runtime_attestation.execution_id, body.execution_id);
  assert.ok(verifyRuntimeAttestationV1(trust.runtime_attestation, identity).ok);
  const action = trust.action_receipts[0];
  assert.ok(verifyActionReceiptV1(action, identity).ok);
  assert.equal(verifyActionReceiptV1({...action, result_digest: "0".repeat(64)}, identity).ok, false);
  assert.equal(verifyActionReceiptV1({...action, signature: {...action.signature, value: "invalid"}}, identity).ok, false);
  assert.ok(trust.inclusion.every(verifyMerkleProofV1));
  assert.equal(registryCommitInstruction(trust.proof_batch).length, 65);
  assert.throws(() => registryCommitInstruction({...trust.proof_batch, merkle_root: "0".repeat(64)}));
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);

  const policy = { programId: "1".repeat(32), authority: "1".repeat(32) };
  const signature = "1".repeat(64);
  const unavailable: typeof fetch = async () => { throw Error("fixture: RPC unavailable"); };
  const devnetResult = (init: RequestInit | undefined, result: unknown) =>
    Response.json({result: typeof init?.body === "string" && JSON.parse(init.body).method === "getGenesisHash"
      ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" : result});
  const missing: typeof fetch = async (_url, init) => devnetResult(init, null);
  assert.deepEqual(await verifyRegistryCommitment(policy, trust.proof_batch, signature, unavailable), {status: "UNKNOWN"});
  assert.deepEqual(await verifyRegistryCommitment(policy, trust.proof_batch, signature, missing), {status: "UNKNOWN"});
  const forged: typeof fetch = async (_url, init) => devnetResult(init, {slot: 1, meta: {err: null},
    transaction: {signatures: [signature], message: {accountKeys: [{pubkey: policy.authority, signer: false}], instructions: []}}});
  assert.deepEqual(await verifyRegistryCommitment(policy, trust.proof_batch, signature, forged), {status: "FAILED"});

  const expired = input();
  await store.submit(scope, expired);
  await runDurableWorkerOnce(store, {model, env: {OSA_DURABLE_CHAT_TRUST: credentials(-1_000)}});
  assert.equal((await store.get(scope, expired.execution_id))?.status, "FAILED");
});

test("TEST E2E fixture: submit, worker, durable readback, proof and no replay",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-cognitive-e2e-"));
  const store=new FileDurableJobStore(root),body=input();
  await store.submit(scope,body);
  let calls=0;
  let observed:Awaited<ReturnType<typeof FleetQueue.observeDurable>>;
  const fake=(async()=>{calls++;observed=await FleetQueue.observeDurable(store,scope,body.execution_id);return reply("2+2=4");}) as typeof nvidiaComplete;
  assert.equal(await runDurableWorkerOnce(store,{model:fake}),1);
  const reopened=new FileDurableJobStore(root);
  const job=await reopened.get(scope,body.execution_id);
  assert.equal(job?.status,"COMPLETED");
  assert.equal(observed?.source,"DURABLE");
  assert.equal(observed?.status,"RUNNING");
  assert.equal(observed?.worker_id,job?.lease?.worker_id);
  assert.equal(observed?.generation,job?.lease?.generation);
  assert.ok(observed?.worker_id);
  assert.equal("token" in observed!,false);
  const finalObservation=await FleetQueue.observeDurable(reopened,scope,body.execution_id);
  assert.equal(finalObservation?.status,"COMPLETED");
  assert.equal(finalObservation?.worker_id,observed?.worker_id);
  const result=job?.result as Awaited<ReturnType<typeof executeDurableJob>>;
  assert.equal(result.execution_id,body.execution_id);
  assert.equal(result.audit?.execution_verdict,"VERIFIED");
  assert.equal(result.audit?.anchor_preparation.status,"NOT_ANCHORED");
  const run=result.audit!.run;
  const workerEvidence=run.evidence.find(e=>e.kind==="chat_provider_response");
  assert.equal(workerEvidence?.agent_id,"nvidia");
  assert.equal(workerEvidence?.data.worker_id,job?.lease?.worker_id);
  assert.equal(workerEvidence?.data.lease_generation,job?.lease?.generation);
  assert.equal(workerEvidence?.binding.execution_id,body.execution_id);
  assert.equal("token" in (workerEvidence?.data??{}),false);
  assert.equal(verifyProofReceipt({receipt:run.proof,evidence:run.evidence,observations:run.observations,
    final_output:run.final_output,tool_calls:run.tool_calls}).ok,true);
  assert.equal(await runDurableWorkerOnce(reopened,{model:fake}),0);
  assert.equal(calls,1);
});

test("TEST: durable cognitive mission performs bounded supervisor repair and seals evidence",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-cognitive-fixture-"));
  const store=new FileDurableJobStore(root), body=input();
  const {job}=await store.submit(scope,body);
  let calls=0;
  const fake=(async()=>reply(++calls===1?"2+2=5":"2+2=4")) as typeof nvidiaComplete;
  const result=await executeDurableJob(job,root,{model:fake});
  assert.equal(result.status,"PROVIDER_RESPONSE");
  assert.equal(calls,2);
  const audit=result.audit!;
  assert.equal(audit.supervisor.repair_count,1);
  assert.equal(audit.execution_verdict,"VERIFIED");
  assert.equal(audit.content_assurance.verdict,"UNKNOWN");
  assert.equal(audit.anchor_preparation.status,"NOT_ANCHORED");
  assert.equal(audit.execution_id,body.execution_id);
  assert.equal(audit.conversation_id,body.conversation_id);
  assert.equal(verifyProofReceipt({receipt:audit.proof,evidence:audit.evidence,observations:audit.observations,
    final_output:audit.final_output,tool_calls:audit.tool_calls}).ok,true);
});

test("TEST: supervisor rejects repeated wrong answer without accepted top-level text",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-cognitive-reject-"));
  const {job}=await new FileDurableJobStore(root).submit(scope,input());
  let calls=0;
  const fake=(async()=>reply(++calls===1?"2+2=5":"2+2=6")) as typeof nvidiaComplete;
  const result=await executeDurableJob(job,root,{model:fake});
  assert.equal(result.status,"SUPERVISOR_REJECTED");
  assert.equal("text" in result,false);
  assert.equal(result.audit?.supervisor.decision,"REJECTED");
  assert.equal(calls,2);
});

test("TEST: same execution ID in different identities cannot collide in MissionStore",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-cognitive-scope-"));
  const store=new FileDurableJobStore(root),body=input();
  const a=await store.submit(scope,body);
  const b=await store.submit({...scope,identity_id:"identity_other"},body);
  const fake=(async()=>reply("2+2=4")) as typeof nvidiaComplete;
  const first=await executeDurableJob(a.job,root,{model:fake});
  const second=await executeDurableJob(b.job,root,{model:fake});
  assert.notEqual(first.audit?.mission_id,second.audit?.mission_id);
});

test("TEST: artifact execution IDs are scoped to identity and project",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-artifact-scope-"));
  const store=new FileDurableJobStore(root),body={...input(),kind:"artifact",agent:undefined,artifact_kind:"webapp"};
  delete body.agent;
  const a=await store.submit(scope,body);
  const b=await store.submit({...scope,identity_id:"identity_other"},body);
  const generate=async()=>({content:'<!doctype html><html lang="pl"><title>Durable</title><body><h1>Test P0</h1></body></html>',
    evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR"}}]});
  const first=await executeDurableJob(a.job,root,{generate});
  const second=await executeDurableJob(b.job,root,{generate});
  assert.ok("mission" in first&&"mission" in second);
  assert.notEqual(first.mission.mission_id,second.mission.mission_id);
});

test("TEST: artifact proof binds host-observed worker lease without exposing token",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-artifact-lease-"));
  const store=new FileDurableJobStore(root),body={...input(),kind:"artifact",agent:undefined,artifact_kind:"webapp"};
  delete body.agent;
  await store.submit(scope,body);
  const generate=async()=>({content:'<!doctype html><html lang="pl"><title>Durable</title><body><h1>Test P0</h1></body></html>',
    evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR"}}]});
  await runDurableWorkerOnce(store,{generate});
  const job=await store.get(scope,body.execution_id);
  assert.equal(job?.status,"COMPLETED");
  const result=job?.result as Extract<Awaited<ReturnType<typeof executeDurableJob>>,{mission:unknown}>;
  const evidence=result.run.evidence.find(e=>e.kind==="durable_worker_lease");
  assert.equal(evidence?.data.worker_id,job?.lease?.worker_id);
  assert.equal(evidence?.data.lease_generation,job?.lease?.generation);
  assert.equal(evidence?.binding.execution_id,body.execution_id);
  assert.equal("token" in (evidence?.data??{}),false);
  assert.equal(verifyProofReceipt({receipt:result.run.proof,evidence:result.run.evidence,
    observations:result.run.observations,final_output:result.run.final_output,tool_calls:result.run.tool_calls}).ok,true);
});

test("TEST: Durable artifact proof requires the existing Supervisor release",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-artifact-supervisor-pass-"));
  const body={...input(),kind:"artifact" as const,agent:undefined,artifact_kind:"webapp" as const};delete body.agent;
  const {job}=await new FileDurableJobStore(root).submit(scope,body);
  const generate=async()=>({content:'<!doctype html><html lang="pl"><title>Durable</title><body><p>2+2=4</p></body></html>',
    evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR"}}]});
  const result=await executeDurableJob(job,root,{generate}) as {status:string;report:{ready_for_review:boolean};run:RunResult;artifact:unknown|null};
  assert.equal(result.status,"EXECUTED");
  assert.equal(result.report.ready_for_review,true);
  const receipt=result.run.proof.requirement_verdicts.find(item=>item.requirement_id==="supervisor_release");
  assert.equal(receipt?.verdict,"VERIFIED");
  const release=result.run.evidence.find(item=>item.kind==="chat_supervisor_release");
  assert.equal(release?.agent_id,"reviewer");
  assert.equal(release?.data.publishable,true);
  assert.equal(verifyProofReceipt({receipt:result.run.proof,evidence:result.run.evidence,
    observations:result.run.observations,final_output:result.run.final_output,tool_calls:result.run.tool_calls}).ok,true);
});

test("TEST: Durable artifact with failed Supervisor equation cannot be published",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-artifact-supervisor-fail-"));
  const body={...input(),kind:"artifact" as const,agent:undefined,artifact_kind:"webapp" as const};delete body.agent;
  const {job}=await new FileDurableJobStore(root).submit(scope,body);
  const generate=async()=>({content:'<!doctype html><html lang="pl"><title>Durable</title><body><p>2+2=5</p></body></html>',
    evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR"}}]});
  const result=await executeDurableJob(job,root,{generate}) as {status:string;report:{ready_for_review:boolean};run:RunResult;artifact:unknown|null};
  assert.equal(result.status,"FAILED");
  assert.equal(result.artifact,null);
  assert.equal(result.report.ready_for_review,false);
  assert.equal(result.run.verdict,"FAILED");
  assert.equal(result.run.proof.requirement_verdicts.find(item=>item.requirement_id==="supervisor_release")?.verdict,"FAILED");
  assert.equal(verifyProofReceipt({receipt:result.run.proof,evidence:result.run.evidence,
    observations:result.run.observations,final_output:result.run.final_output,tool_calls:result.run.tool_calls}).ok,true);
});

test("TEST: ZERO_COST policy blocks before a provider request when free access is not acknowledged",async()=>{
  let called=false;
  const fakeFetch=(async()=>{called=true;throw Error("PROVIDER_MUST_NOT_BE_CALLED");}) as typeof fetch;
  await assert.rejects(nvidiaComplete("test",{OSA_ZERO_COST_ONLY:"true",NVIDIA_API_KEY:"test"},fakeFetch),/bezpłatnego|free/i);
  assert.equal(called,false);
});

test("TEST: durable fails closed even with provider-wide free-tier acknowledgement",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-cognitive-cost-"));
  const store=new FileDurableJobStore(root),body=input();
  await store.submit(scope,body);
  const originalFetch=globalThis.fetch;
  let called=false;
  globalThis.fetch=(async()=>{called=true;throw Error("PROVIDER_MUST_NOT_BE_CALLED");}) as typeof fetch;
  try {
    await runDurableWorkerOnce(store,{env:{OSA_NVIDIA_FREE_TIER_ACK:"true",NVIDIA_API_KEY:"fixture"}});
    assert.equal(called,false);
    assert.equal((await store.get(scope,body.execution_id))?.error_code,"DURABLE_ZERO_COST_MODEL_UNCONFIRMED");
  } finally { globalThis.fetch=originalFetch; }
});

test("TEST: uncertain execution remains UNKNOWN and is not automatically retried",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-cognitive-unknown-"));
  const store=new FileDurableJobStore(root),body=input();
  await store.submit(scope,body);
  let calls=0;
  const fake=(async()=>{calls++;throw Error("SIMULATED_PROVIDER_TIMEOUT_AFTER_DISPATCH");}) as typeof nvidiaComplete;
  await runDurableWorkerOnce(store,{model:fake});
  const job=await store.get(scope,body.execution_id);
  assert.equal((await store.publicStatus(job!)).status,"UNKNOWN");
  await runDurableWorkerOnce(new FileDurableJobStore(root),{model:fake});
  assert.equal(calls,1);
});
