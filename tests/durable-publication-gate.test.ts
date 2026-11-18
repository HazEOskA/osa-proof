import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { executeDurableJob } from "../apps/worker/src/durable-executor";
import { nvidiaComplete } from "../apps/api/src/nvidia";
import { FileDurableJobStore } from "../packages/durable-execution/src";
import { ExecutorRegistry, FileMissionStore } from "../packages/runtime/src";

const scope={organization_id:"org_dev_local",identity_id:"identity_publication_test",project_id:"project_publication"};
const body=()=>({execution_id:"exec_"+randomUUID(),conversation_id:randomUUID(),kind:"model",prompt:"Ile to 2+2?",agent:"jeverson"});
const fake=(async()=>({provider:"NVIDIA",model:"fixture",text:"2+2=4",request_id:randomUUID(),
  request_sha256:"a".repeat(64),provider_response_id:"fixture",latency_ms:1,http_status:200,
  finish_reason:"stop",status:"PROVIDER_RESPONSE"})) as typeof nvidiaComplete;

async function setup() {
  const root=await mkdtemp(join(tmpdir(),"osa-publication-gate-"));
  const durable=new FileDurableJobStore(root);
  const missionStore=new FileMissionStore(join(root,"missions"));
  const state=new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,undefined,missionStore,durable);
  const server=createApiServer(new ExecutorRegistry(),state);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {root,durable,base,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}

test("Durable publication: VERIFIED MissionStore must stay private until authoritative COMPLETED",async t=>{
  const s=await setup();t.after(s.close);
  const input=body();await s.durable.submit(scope,input);
  const [path]=await s.durable.queued();
  const job=(await s.durable.claim(path))!;
  const result=await executeDurableJob(job,s.root,{model:fake});
  assert.equal(result.audit?.execution_verdict,"VERIFIED");
  const missionId=result.audit!.mission_id;
  const pending=await (await fetch(s.base+"/missions")).json() as Array<{mission:{mission_id:string}}>;
  assert.equal(pending.some(r=>r.mission.mission_id===missionId),false);
  assert.equal((await fetch(s.base+"/missions/"+missionId)).status,404);
  await s.durable.finish(job,"COMPLETED",result);
  const accepted=await (await fetch(s.base+"/missions")).json() as Array<{mission:{mission_id:string}}>;
  assert.equal(accepted.some(r=>r.mission.mission_id===missionId),true);
  assert.equal((await fetch(s.base+"/missions/"+missionId)).status,200);
});

test("Durable publication: expired lease must not expose precommitted VERIFIED proof",async t=>{
  const s=await setup();t.after(s.close);
  const input=body();await s.durable.submit(scope,input);
  const [path]=await s.durable.queued();
  const job=(await s.durable.claim(path))!;
  const result=await executeDurableJob(job,s.root,{model:fake});
  assert.equal(result.audit?.execution_verdict,"VERIFIED");
  const record=JSON.parse(await readFile(path,"utf8"));
  record.lease.expires_at=new Date(Date.now()-1000).toISOString();
  await writeFile(path,JSON.stringify(record));
  await assert.rejects(s.durable.finish(job,"COMPLETED",result),/DURABLE_RESULT_FENCE/);
  const list=await (await fetch(s.base+"/missions")).json() as Array<{mission:{mission_id:string}}>;
  assert.equal(list.some(r=>r.mission.mission_id===result.audit!.mission_id),false);
  assert.equal((await fetch(s.base+"/missions/"+result.audit!.mission_id)).status,404);
});
