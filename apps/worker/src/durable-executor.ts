import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EvidenceInput } from "../../../packages/contracts/src";
import { demoMission, demoReport, demoTeam, installDemoExecutors, type DemoRequest } from "../../../packages/demo-team/src";
import { ExecutorRegistry, FileMissionStore, MissionKernel } from "../../../packages/runtime/src";
import { digest, verifyCompletedMission } from "../../../packages/proof-core/src";
import { nvidiaComplete, fleetLimit } from "../../api/src/nvidia";
import { FileDurableJobStore, type DurableJob } from "../../../packages/durable-execution/src";

export type DurableArtifactGenerator=(request:DemoRequest)=>Promise<{content:string;evidence:EvidenceInput[]}>;
export interface DurableWorkerOptions {
  generate?:DurableArtifactGenerator;
  model?:typeof nvidiaComplete;
  env?:NodeJS.ProcessEnv;
}
export async function executeDurableJob(job:DurableJob,root:string,options:DurableWorkerOptions={}) {
  const input=job.input;
  const model=options.model??nvidiaComplete;
  if(input.kind==="model") {
    const answer=await model(input.prompt,{...(options.env??process.env),OSA_ZERO_COST_ONLY:"true"},fetch,{agent:input.agent,history:input.history});
    return {...answer,execution_id:input.execution_id,conversation_id:input.conversation_id};
  }
  const kernel=new MissionKernel(new FileMissionStore(join(root,"missions")));
  const registry=new ExecutorRegistry();
  const team=demoTeam({organization_id:job.scope.organization_id,project_id:job.scope.project_id});
  const mission=demoMission({objective:input.prompt,kind:input.artifact_kind!,mode:"connected",target:"artifact"},team);
  mission.mission_id="delivery_"+digest(job.scope.organization_id).slice(0,12)+"_"+input.execution_id.slice(5);
  const generate=options.generate??(async (spec:DemoRequest)=>{
    const answer=await model(spec.objective,{...(options.env??process.env),OSA_ZERO_COST_ONLY:"true"},fetch,
      {agent:"coding",artifact:spec.kind as "webapp"|"document"});
    const content=answer.text.replace(/^\s*`{3}(?:html|markdown|md)?\s*\n/i,"").replace(/\n`{3}\s*$/,"");
    return {content,evidence:[{kind:"model_artifact_generation",data:{provider:answer.provider,model:answer.model,
      request_id:answer.request_id,provider_response_id:answer.provider_response_id,request_sha256:answer.request_sha256,
      response_sha256:createHash("sha256").update(answer.text).digest("hex"),latency_ms:answer.latency_ms,
      execution_id:input.execution_id}}]};
  });
  installDemoExecutors(registry,{executionMode:"provider",artifactGenerator:async spec=>{
    const result=await generate(spec);
    if(!result.content.trim()||Buffer.byteLength(result.content)>128*1024)throw Error("DURABLE_ARTIFACT_SIZE_INVALID");
    return result;
  }});
  await kernel.create(mission,team);
  const run=await kernel.execute(mission.mission_id,registry,{execution_id:input.execution_id});
  const record=await kernel.get(mission.mission_id);
  if(!record)throw Error("DURABLE_MISSION_UNAVAILABLE");
  const report=demoReport(record);
  if(report.ready_for_review)verifyCompletedMission(record);
  const body={
    schema:"osa.chat_delivery.v1",execution_id:input.execution_id,conversation_id:input.conversation_id,
    status:report.ready_for_review?"EXECUTED":"FAILED",team,mission,run,record,report,
    artifact:report.ready_for_review?report.artifact:null,
    verification_scope:"ARTIFACT_BYTES_STRUCTURE_AND_EXECUTION_EVIDENCE",
    limitations:["Server worker was independent of the browser connection.",
      "Durability requires a persistent shared filesystem and separately running worker.",
      "No remote deployment or NeurOSA memory write was claimed."]
  };
  return {...body,bundle_sha256:digest(body)};
}
export async function runDurableWorkerOnce(store:FileDurableJobStore,options:DurableWorkerOptions={}) {
  await store.workerHeartbeat();
  let completed=0;
  for(const file of await store.queued()) {
    const job=await store.claim(file);
    if(!job)continue;
    let pulse:Promise<void>|undefined;
    const heartbeat=setInterval(()=>{
      if(pulse)return;
      pulse=Promise.all([store.workerHeartbeat(),store.touch(job)]).then(()=>{}).catch(()=>{}).finally(()=>{pulse=undefined;});
    },5000);
    heartbeat.unref();
    let result:unknown,failed=false;
    try {if(!options.model&&!options.generate)fleetLimit();result=await executeDurableJob(job,store.root,options);}
    catch {failed=true;}
    finally {
      clearInterval(heartbeat);
      if(pulse)await pulse;
    }
    await store.finish(job,failed?"FAILED":"COMPLETED",result,failed?"DURABLE_JOB_FAILED":undefined);
    completed++;
  }
  return completed;
}
