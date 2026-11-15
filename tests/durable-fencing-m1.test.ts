import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileDurableJobStore } from "../packages/durable-execution/src";
import { FleetQueue } from "../packages/fleet/src";

// Each test creates fresh, synthetic files. They are deliberately left in the
// temporary directory; no existing store or user's files are removed.
const scope={organization_id:"org_fence_test",identity_id:"test_identity",project_id:"project_fence_test"};
const input=()=>({execution_id:`exec_${randomUUID()}`,conversation_id:randomUUID(),kind:"model",prompt:"synthetic",agent:"jeverson"});

test("durable lease: token/generation fence and expiry preserve UNKNOWN without replay",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-fence-"));
  const store=new FileDurableJobStore(root);
  const body=input();
  await store.submit(scope,body);
  const [path]=await store.queued();
  const job=(await store.claim(path))!;
  assert.ok(job.lease?.token);
  assert.match(job.lease!.worker_id!,/^worker_[a-f0-9-]{36}$/);
  assert.equal(job.lease?.generation,1);
  const observed=await FleetQueue.observeDurable(store,scope,body.execution_id);
  assert.equal(observed?.source,"DURABLE");
  assert.equal(observed?.worker_id,job.lease!.worker_id);
  assert.equal(observed?.generation,job.lease!.generation);
  assert.equal(JSON.stringify(observed).includes(job.lease!.token),false);
  assert.equal(await FleetQueue.observeDurable(store,{...scope,project_id:"other_project"},body.execution_id),undefined);
  await assert.rejects(store.touch({...job,lease:{...job.lease!,token:randomUUID()}}),/DURABLE_HEARTBEAT_FENCE/);
  await assert.rejects(store.finish({...job,lease:{...job.lease!,generation:job.lease!.generation+1}},"COMPLETED",{value:"forged"}),/DURABLE_RESULT_FENCE/);
  await assert.rejects(store.finish({...job,lease:{...job.lease!,worker_id:`worker_${randomUUID()}`}},"COMPLETED",{value:"forged"}),/DURABLE_RESULT_FENCE/);
  await store.touch(job);
  const record=JSON.parse(await readFile(path,"utf8"));
  record.lease.expires_at=new Date(Date.now()-1000).toISOString();
  await writeFile(path,JSON.stringify(record));
  const reopened=new FileDurableJobStore(root);
  assert.equal((await reopened.publicStatus((await reopened.get(scope,body.execution_id))!)).status,"UNKNOWN");
  assert.equal((await FleetQueue.observeDurable(reopened,scope,body.execution_id))?.status,"UNKNOWN");
  await assert.rejects(reopened.touch(job),/DURABLE_HEARTBEAT_FENCE/);
  await assert.rejects(reopened.finish(job,"COMPLETED",{value:"late"}),/DURABLE_RESULT_FENCE/);
  assert.equal(await reopened.claim(path),undefined);
  assert.equal((await reopened.get(scope,body.execution_id))?.status,"UNKNOWN");
  assert.equal((await reopened.submit(scope,body)).created,false);
  await assert.rejects(reopened.submit(scope,{...body,prompt:"different"}),/DURABLE_ID_CONFLICT/);
});

test("durable expiry uses one observation time and persists UNKNOWN before reporting it",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-clock-boundary-"));
  const store=new FileDurableJobStore(root),body=input();
  await store.submit(scope,body);
  const [path]=await store.queued();
  const claimed=(await store.claim(path))!;
  const deadline=Date.parse(claimed.lease!.expires_at);
  const originalNow=Date.now;
  try {
    let calls=0;
    // Time crosses the deadline after the observation. The response must not
    // report UNKNOWN unless that state was durably recorded.
    Date.now=()=>++calls<=2?deadline-1:deadline+1;
    assert.equal((await store.publicStatus(claimed)).status,"RUNNING");
    assert.equal((await store.get(scope,body.execution_id))?.status,"RUNNING");
    Date.now=()=>deadline+1;
    assert.equal((await store.publicStatus(claimed)).status,"UNKNOWN");
    assert.equal((await new FileDurableJobStore(root).get(scope,body.execution_id))?.status,"UNKNOWN");
    Date.now=()=>deadline-1;
    assert.equal((await store.publicStatus(claimed)).status,"UNKNOWN");
    await assert.rejects(store.finish(claimed,"COMPLETED",{late:true}),/DURABLE_RESULT_FENCE/);
  } finally {Date.now=originalNow;}
});

test("durable status reloads a stale snapshot and does not lock a live lease",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-status-race-"));
  const store=new FileDurableJobStore(root),body=input();
  await store.submit(scope,body);
  const [path]=await store.queued();
  const claimed=(await store.claim(path))!;
  const stale={...claimed,lease:{...claimed.lease!,expires_at:new Date(0).toISOString()}};
  assert.equal((await store.publicStatus(stale)).status,"RUNNING");
  await store.finish(claimed,"COMPLETED",{ok:true});
  assert.equal((await store.publicStatus(stale)).status,"COMPLETED");
});

test("expired lease becomes UNKNOWN across processes and fences a late result",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-cross-process-"));
  const store=new FileDurableJobStore(root),body=input();
  await store.submit(scope,body);
  const [file]=await store.queued();
  const claimed=(await store.claim(file))!;
  const record=JSON.parse(await readFile(file,"utf8"));
  record.lease.expires_at=new Date(Date.now()-1000).toISOString();
  await writeFile(file,JSON.stringify(record));
  const modulePath=require.resolve("../packages/durable-execution/src");
  const script=`const {FileDurableJobStore}=require(process.argv[1]);
    const scope=JSON.parse(process.argv[3]);
    (async()=>{const store=new FileDurableJobStore(process.argv[2]);
      const job=await store.get(scope,process.argv[4]);
      const status=await store.publicStatus(job);
      if(status.status!=="UNKNOWN")process.exitCode=2;
    })().catch(e=>{console.error(e);process.exitCode=1;});`;
  const exitCode=await new Promise<number|null>((resolve,reject)=>{
    const child=spawn(process.execPath,["-e",script,modulePath,root,JSON.stringify(scope),body.execution_id],{stdio:"pipe"});
    child.once("error",reject);
    child.once("exit",resolve);
  });
  assert.equal(exitCode,0);
  assert.equal((await new FileDurableJobStore(root).get(scope,body.execution_id))?.status,"UNKNOWN");
  const originalNow=Date.now;
  try {
    Date.now=()=>Date.parse(record.lease.expires_at)-1;
    await assert.rejects(store.finish(claimed,"COMPLETED",{late:true}),/DURABLE_RESULT_FENCE/);
  } finally {Date.now=originalNow;}
});

test("durable lease: legacy records remain readable without granting a fabricated lease",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-legacy-"));
  const store=new FileDurableJobStore(root);
  const body=input();
  await store.submit(scope,body);
  const [path]=await store.queued();
  const legacy=JSON.parse(await readFile(path,"utf8"));
  legacy.status="RUNNING";
  legacy.updated_at="2020-01-01T00:00:00.000Z";
  await writeFile(path,JSON.stringify(legacy));
  const loaded=(await store.get(scope,body.execution_id))!;
  assert.equal((await store.publicStatus(loaded)).status,"UNKNOWN");
  await assert.rejects(store.finish(loaded,"COMPLETED",{}),/DURABLE_RESULT_FENCE/);
  assert.equal(await store.claim(path),undefined);
});

test("durable lease: uncertain provider outcome is persisted and cannot be replayed",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-unknown-"));
  const store=new FileDurableJobStore(root);
  const body=input();
  await store.submit(scope,body);
  const [path]=await store.queued();
  const claimed=(await store.claim(path))!;
  await store.markUnknown(claimed);
  const loaded=(await new FileDurableJobStore(root).get(scope,body.execution_id))!;
  assert.equal(loaded.status,"UNKNOWN");
  assert.equal((await store.publicStatus(loaded)).status,"UNKNOWN");
  await assert.rejects(store.finish(claimed,"COMPLETED",{value:"late"}),/DURABLE_RESULT_FENCE/);
  assert.equal(await new FileDurableJobStore(root).claim(path),undefined);
});

test("durable lease: one claim across two store instances",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-claim-"));
  const first=new FileDurableJobStore(root),second=new FileDurableJobStore(root);
  const body=input();
  await first.submit(scope,body);
  const [path]=await first.queued();
  const claims=await Promise.all([first.claim(path),second.claim(path)]);
  assert.equal(claims.filter(Boolean).length,1);
  const claimed=claims.find(Boolean)!;
  const stored=await second.get(scope,body.execution_id);
  assert.deepEqual(stored?.lease,claimed.lease);
  await second.finish(claimed,"COMPLETED",{source:"SYNTHETIC_TEST"});
  await assert.rejects(first.finish(claimed,"COMPLETED",{source:"LATE"}),/DURABLE_RESULT_FENCE/);
});

test("durable cancellation: QUEUED only, idempotent and scope isolated",async()=>{
  const root=await mkdtemp(join(tmpdir(),"osa-m1-cancel-"));
  const store=new FileDurableJobStore(root);
  const body=input();
  await store.submit(scope,body);
  assert.equal((await store.cancelQueued(scope,body.execution_id)).status,"CANCELLED");
  assert.equal((await store.cancelQueued(scope,body.execution_id)).status,"CANCELLED");
  assert.equal((await store.publicStatus((await store.get(scope,body.execution_id))!)).status,"CANCELLED");
  const [path]=await store.queued();
  assert.equal(await store.claim(path),undefined);
  await assert.rejects(store.cancelQueued({...scope,project_id:"other"},body.execution_id),/DURABLE_JOB_NOT_FOUND/);
  assert.equal((await store.get(scope,body.execution_id))?.status,"CANCELLED");
});

test("durable cancellation races claim using the shared lock",async()=>{
  for(let i=0;i<8;i++){
    const root=await mkdtemp(join(tmpdir(),"osa-m1-cancel-race-"));
    const a=new FileDurableJobStore(root),b=new FileDurableJobStore(root),body=input();
    await a.submit(scope,body);
    const [path]=await a.queued();
    const [cancel,claim]=await Promise.allSettled([a.cancelQueued(scope,body.execution_id),b.claim(path)]);
    const stored=(await a.get(scope,body.execution_id))!;
    if(cancel.status==="fulfilled"){
      assert.equal(cancel.value.status,"CANCELLED");
      assert.equal(stored.status,"CANCELLED");
      assert.ok(claim.status==="fulfilled"&&claim.value===undefined);
    } else {
      assert.match(String(cancel.reason),/DURABLE_CANCEL_BUSY|DURABLE_CANCEL_UNCONFIRMED/);
      assert.ok(claim.status==="fulfilled"&&claim.value);
      assert.equal(stored.status,"RUNNING");
      await assert.rejects(a.cancelQueued(scope,body.execution_id),/DURABLE_CANCEL_BUSY|DURABLE_CANCEL_UNCONFIRMED/);
    }
  }
});
