import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createWorkerServer } from "../apps/worker/src";
import { DockerWorkspaceProvider, RemoteWorkspaceProvider } from "../packages/workspace-runtime/src";
import { sandboxExecutor } from "../packages/fleet/src";
import { ExecutorRegistry, MissionKernel } from "../packages/runtime/src";
import { verifyCompletedMission } from "../packages/proof-core/src";
import type { TeamGraph, Mission } from "../packages/contracts/src";

test("LIVE Docker: Worker Host HTTP → sandbox → Runtime → zweryfikowany receipt → cleanup",{skip:process.env.OSA_LOCAL_DOCKER_TEST!=="1",timeout:180000},async()=>{
  const token=randomBytes(32).toString("hex");
  const scope={organization_id:"org_worker_smoke",project_id:"osa-proof",mission_id:"worker_"+randomUUID()};
  const provider=new DockerWorkspaceProvider({image:"node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402"});
  const server=createWorkerServer({token,provider,scope,maxWorkspaces:1});
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const remote=new RemoteWorkspaceProvider({baseUrl:base,token});
  const ids:string[]=[];
  try {
    const input={workspaceId:"denied",timeoutMs:1000,scope:{...scope,task_id:"denied"}};
    assert.equal((await fetch(base+"/v1/workspaces",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)})).status,401);
    await assert.rejects(remote.create({...input,scope:{...input.scope,organization_id:"foreign"}}),/HTTP 403/);
    const registry=new ExecutorRegistry();
    registry.register("osa.sandbox.smoke.v1",sandboxExecutor(remote,async(context,w)=>{
      ids.push(w.id);
      assert.equal(w.metadata?.provider,"docker");assert.equal(w.metadata?.network,"none");
      await w.writeFile("/workspace/proof.txt","OSA Worker Host");
      const result=await w.exec("node",["-e","const fs=require('fs'),crypto=require('crypto');console.log(JSON.stringify({uid:process.getuid(),sha256:crypto.createHash('sha256').update(fs.readFileSync('/workspace/proof.txt')).digest('hex')}));"],{timeoutMs:10000});
      assert.equal(result.exitCode,0);const output=JSON.parse(result.stdout);
      assert.equal(output.uid,1000);assert.equal(output.sha256,createHash("sha256").update("OSA Worker Host").digest("hex"));
      assert.notEqual((await w.exec("sh",["-c","echo denied > /etc/osa-worker-denied"],{timeoutMs:10000})).exitCode,0);
      return {output:{...output,execution_id:context.execution_id},evidence:[{kind:"sandbox_result",data:{status:"OK",sha256:output.sha256}}]};
    },120000));
    const team:TeamGraph={organization_id:scope.organization_id,project_id:scope.project_id,team_id:"worker-smoke",version:"1",agents:[{agent_id:"worker",role:"Weryfikacja izolacji",executor_ref:"osa.sandbox.smoke.v1"}],edges:[]};
    const mission:Mission={...scope,team_id:team.team_id,team_version:team.version,entry_agent_id:"worker",objective:"Sprawdź rzeczywisty sandbox i zamknięcie kontenera",input:{},requirements:[{requirement_id:"sandbox-ok",type:"evidence_field_equals",agent_id:"worker",evidence_kind:"sandbox_result",field:"status",expected:"OK"}],policy:{allowed_executor_refs:["osa.sandbox.smoke.v1"],required_receipts:["sandbox_receipt"]}};
    const kernel=new MissionKernel();await kernel.create(mission,team);await kernel.plan(mission.mission_id,registry);
    const run=await kernel.execute(mission.mission_id,registry),record=(await kernel.get(mission.mission_id))!;
    assert.equal(record.state,"COMPLETED");verifyCompletedMission(record);assert.equal(ids.length,1);
    assert.equal((await (await fetch(base+"/health")).json()).active_workspaces,0);
    assert.notEqual(spawnSync("docker",["inspect",ids[0]],{stdio:"pipe"}).status,0);
    const report={result:"PASS",execution_id:run.execution_id,mission_id:mission.mission_id,provider:"docker",transport:"Worker Host HTTP / RemoteWorkspaceProvider",model_calls:0,isolated_uid:1000,network:"none",root_write_denied:true,unauthorized_denied:true,foreign_scope_denied:true,container_removed:true,receipt_verified:true,cloud_deployment:false};
    if(process.env.OSA_REVIEW_DIR){const dir=resolve(process.env.OSA_REVIEW_DIR);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,"worker-mission.json"),JSON.stringify(record,null,2),{mode:0o600});await writeFile(join(dir,"worker-result.json"),JSON.stringify(report,null,2),{mode:0o600});}
    console.log(JSON.stringify(report));
  } finally {
    for(const id of ids)spawnSync("docker",["rm","-f",id],{stdio:"pipe"});
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  }
});
