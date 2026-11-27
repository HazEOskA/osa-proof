import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EvidenceInput } from "../../../packages/contracts/src";
import { demoMission, demoReport, demoTeam, installDemoExecutors, type DemoRequest } from "../../../packages/demo-team/src";
import { ExecutorRegistry, FileMissionStore, MissionKernel } from "../../../packages/runtime/src";
import { digest, verifyCompletedMission, verifyMissionExecution } from "../../../packages/proof-core/src";
import { ModelMesh, type ModelProvider } from "../../../packages/adapters/src";
import { prepareOfflineProofAnchor } from "../../../packages/web3/src/anchor";
import { runCognitiveChat } from "../../api/src/chat-cognitive";
import { assessChatContent } from "../../api/src/chat-assurance";
import { nvidiaComplete, nvidiaStatus, fleetLimit } from "../../api/src/nvidia";
import { FileDurableJobStore, durableLocalSandboxConfigured, type DurableJob } from "../../../packages/durable-execution/src";
import { FleetQueue } from "../../../packages/fleet/src";
import { DockerWorkspaceProvider } from "../../../packages/workspace-runtime/src";

export type DurableArtifactGenerator=(request:DemoRequest)=>Promise<{content:string;evidence:EvidenceInput[]}>;
export class DurableWorkerBlocked extends Error {
  constructor(readonly code:string) { super(code); }
}
export interface DurableWorkerOptions {
  generate?:DurableArtifactGenerator;
  model?:typeof nvidiaComplete;
  env?:NodeJS.ProcessEnv;
}
export async function executeDurableJob(job:DurableJob,root:string,options:DurableWorkerOptions={}) {
  const input=job.input;
  const sandbox=input.kind==="artifact"&&input.artifact_target==="sandbox";
  if(sandbox&&!durableLocalSandboxConfigured(options.env??process.env))throw new DurableWorkerBlocked("DURABLE_SANDBOX_NOT_CONFIGURED");
  // A provider-wide acknowledgement is not proof that the selected model and
  // account cannot incur charges. Until a model-specific cost contract exists,
  // block live calls. Injected functions are reserved for isolated test harnesses.
  if(!options.model&&(input.kind==="model"||!options.generate))
    throw new DurableWorkerBlocked("DURABLE_ZERO_COST_MODEL_UNCONFIRMED");
  const model=options.model??nvidiaComplete;
  const env={...(options.env??process.env),OSA_ZERO_COST_ONLY:"true"};
  // Use the existing mesh with the one provider whose cost policy this worker
  // can currently enforce. Additional targets need an independently verified
  // free-cost policy and adapter; no fallback to a paid/unknown target.
  async function complete(prompt:string,context:Parameters<typeof nvidiaComplete>[3]) {
    let answer:Awaited<ReturnType<typeof nvidiaComplete>>|undefined;
    const target:ModelProvider={id:"NVIDIA",model:nvidiaStatus(env).model,complete:async()=>{
      if(!options.model)fleetLimit(); // count every actual call, including repair
      answer=await model(prompt,env,fetch,context);
      return {provider:answer.provider,model:answer.provider_model??answer.model,
        response_id:answer.provider_response_id??"",http_status:answer.http_status,stop_reason:answer.finish_reason??"unknown",
        text:answer.text,usage:{},latency_ms:answer.latency_ms,request_sha256:answer.request_sha256,
        response_sha256:createHash("sha256").update(answer.text).digest("hex")};
    }};
    const routed=await new ModelMesh([target]).complete({system:"",prompt,output_schema:{}});
    if(!answer)throw Error("DURABLE_MODEL_RESPONSE_MISSING");
    return {answer,hops:routed.hops??[]};
  }
  if(input.kind==="model") {
    const kernel=new MissionKernel(new FileMissionStore(join(root,"missions")));
    const hops:unknown[]=[];
    const {answer,supervisor,run,record}=await runCognitiveChat({
      kernel,durableScope:job.scope,projectId:job.scope.project_id,prompt:input.prompt,executionId:input.execution_id,
      ...(job.lease?.worker_id?{durableLease:{worker_id:job.lease.worker_id,generation:job.lease.generation,execution_id:input.execution_id}}:{}),
      complete:async repair=>{
        const routed=await complete(input.prompt,{agent:input.agent,history:input.history,...(repair?{repair}:{})});
        hops.push(...routed.hops);
        return routed.answer;
      },
    });
    verifyMissionExecution(record.team,record.mission,run,{trustedClaimEnforcement:"REPORT_ONLY"});
    if(run.verdict==="VERIFIED")verifyCompletedMission(record,{trustedClaimEnforcement:"REPORT_ONLY"});
    const content_assurance=assessChatContent(run.verdict);
    const anchor_preparation=prepareOfflineProofAnchor({receipt:run.proof,evidence:run.evidence,
      observations:run.observations,final_output:run.final_output,tool_calls:run.tool_calls},new Date().toISOString());
    const audit={schema:"osa.chat_audit.v1",execution_id:input.execution_id,conversation_id:input.conversation_id,
      mission_id:record.mission.mission_id,run_id:run.run_id,team:record.team,mission:record.mission,run,
      planner_receipt:record.brain?.planning_receipt,
      proof:run.proof,evidence:run.evidence,observations:run.observations,tool_calls:run.tool_calls,
      supervisor,final_output:answer.text,response_sha256:createHash("sha256").update(answer.text).digest("hex"),
      execution_verdict:run.verdict,content_assurance,model_hops:hops,anchor_preparation,
      limitations:["APR ocenia wykonanie i obsługiwane wymagania, nie ogólną prawdziwość treści.",
        "Anchor przygotowano offline; brak potwierdzenia on-chain i brak zapisu NeurOSA."]};
    // Never expose a rejected model answer as PROVIDER_RESPONSE to the UI.
    if(run.verdict!=="VERIFIED"||!supervisor.publishable)
      return {status:"SUPERVISOR_REJECTED",execution_id:input.execution_id,conversation_id:input.conversation_id,audit};
    return {...answer,execution_id:input.execution_id,conversation_id:input.conversation_id,
      execution_verdict:run.verdict,supervisor,content_assurance,audit};
  }
  const kernel=new MissionKernel(new FileMissionStore(join(root,"missions")));
  const registry=new ExecutorRegistry();
  const team=demoTeam({organization_id:job.scope.organization_id,project_id:job.scope.project_id});
  const mission=demoMission({objective:input.prompt,kind:input.artifact_kind!,mode:"connected",target:sandbox?"sandbox":"artifact"},team,true);
  // Execution IDs are unique only within durable scope, not globally.
  // Existing records remain readable with their original mission IDs.
  mission.mission_id="delivery_"+digest([job.scope.organization_id,job.scope.project_id,job.scope.identity_id,input.execution_id]);
  const generate=options.generate??(async (spec:DemoRequest)=>{
    const {answer}=await complete(spec.objective,{agent:"coding",artifact:spec.kind as "webapp"|"document"});
    const content=answer.text.replace(/^\s*`{3}(?:html|markdown|md)?\s*\n/i,"").replace(/\n`{3}\s*$/,"");
    return {content,evidence:[{kind:"model_artifact_generation",data:{provider:answer.provider,model:answer.model,
      request_id:answer.request_id,provider_response_id:answer.provider_response_id,request_sha256:answer.request_sha256,
      response_sha256:createHash("sha256").update(answer.text).digest("hex"),latency_ms:answer.latency_ms,
      execution_id:input.execution_id}}]};
  });
  installDemoExecutors(registry,{executionMode:"provider",supervisorGate:true,...(sandbox?{workspace:new DockerWorkspaceProvider({network:"none"})}:{}),artifactGenerator:async spec=>{
    const result=await generate(spec);
    if(!result.content.trim()||Buffer.byteLength(result.content)>128*1024)throw Error("DURABLE_ARTIFACT_SIZE_INVALID");
    return {...result,evidence:[...result.evidence,...(job.lease?.worker_id?[{
      kind:"durable_worker_lease",data:{worker_id:job.lease.worker_id,lease_generation:job.lease.generation,
        execution_id:input.execution_id},
    }]:[])]};
  }});
  await kernel.create(mission,team);
  const run=await kernel.execute(mission.mission_id,registry,{execution_id:input.execution_id});
  const record=await kernel.get(mission.mission_id);
  if(!record)throw Error("DURABLE_MISSION_UNAVAILABLE");
  const report=demoReport(record);
  if(report.ready_for_review)verifyCompletedMission(record);
  const anchor_preparation=report.ready_for_review?prepareOfflineProofAnchor({receipt:run.proof,evidence:run.evidence,
    observations:run.observations,final_output:run.final_output,tool_calls:run.tool_calls},new Date().toISOString()):undefined;
  const body={
    schema:"osa.chat_delivery.v1",execution_id:input.execution_id,conversation_id:input.conversation_id,
    status:report.ready_for_review?"EXECUTED":"FAILED",team,mission,run,record,report,
    artifact:report.ready_for_review?report.artifact:null,
    ...(anchor_preparation?{anchor_preparation}:{}),
    verification_scope:sandbox?"ARTIFACT_BYTES_STRUCTURE_SANDBOX_BUILD_AND_EXECUTION_EVIDENCE":"ARTIFACT_BYTES_STRUCTURE_AND_EXECUTION_EVIDENCE",
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
    // Fleet observes the durable claim only; it does not create a second job
    // or independent lease. Fail closed if the authoritative view disagrees.
    const observed=await FleetQueue.observeDurable(store,job.scope,job.input.execution_id);
    if(!observed||observed.status!=="RUNNING"||!job.lease?.worker_id||
      observed.worker_id!==job.lease.worker_id||observed.generation!==job.lease.generation)
      throw Error("DURABLE_FLEET_OBSERVATION_UNCONFIRMED");
    let pulse:Promise<void>|undefined;
    const heartbeat=setInterval(()=>{
      if(pulse)return;
      pulse=Promise.all([store.workerHeartbeat(),store.touch(job)]).then(()=>{}).catch(()=>{}).finally(()=>{pulse=undefined;});
    },5000);
    heartbeat.unref();
    let result:unknown,failed=false,blockedCode:string|undefined;
    try {result=await executeDurableJob(job,store.root,options);}
    catch (error) {failed=true;if(error instanceof DurableWorkerBlocked)blockedCode=error.code;}
    finally {
      clearInterval(heartbeat);
      if(pulse)await pulse;
    }
    if(!failed) await store.finish(job,"COMPLETED",result);
    else if(blockedCode) await store.finish(job,"FAILED",undefined,blockedCode);
    // Once execution began an exception does not prove whether an external
    // effect occurred. Preserve uncertainty; do not retry or publish a result.
    else await store.markUnknown(job,"DURABLE_EXECUTION_UNCONFIRMED");
    completed++;
  }
  return completed;
}
