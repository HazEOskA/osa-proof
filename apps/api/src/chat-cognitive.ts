import { createHash } from "node:crypto";
import type { Mission, SessionRecord, TeamGraph } from "../../../packages/contracts/src";
import { ExecutorRegistry, MissionKernel } from "../../../packages/runtime/src";
import {
  reviewChatCandidate, sealSupervisorRelease, supervisorRepairFeedback,
  type SupervisorReview, type SupervisorRelease, type SupervisorAttempt,
} from "../../../packages/supervisor-adapter/src/chat-supervisor";
import { executeCognitiveMission, planningOnlyKernel } from "./cognitive-execution";

const CHAT_EXECUTOR = "osa.chat.nvidia.v1";
const SUPERVISOR_EXECUTOR = "osa.chat.supervisor.v1";
const hash = (text: string) => createHash("sha256").update(text,"utf8").digest("hex");
export type CognitiveModelAnswer = {
  text: string;
  model: string;
  provider_response_id: string | null;
  request_sha256: string;
};
export type SupervisorRepair = { feedback: string; prior_response_sha256: string };
export type CognitiveChatOptions<T extends CognitiveModelAnswer> = {
  kernel: MissionKernel;
  session: SessionRecord;
  projectId: string;
  prompt: string;
  executionId: string;
  complete: (repair?:SupervisorRepair) => Promise<T>;
  onPlanned?: () => void;
  onAnswer?: (answer:T) => void;
  onSupervisor?: (review:SupervisorReview,attempt:number) => void;
  onRepair?: (repair:SupervisorRepair) => void;
};
/** Mandatory path: approved Brain plan -> Worker -> independent bounded
 * Supervisor -> APR. Repairs occur INSIDE the supervised executor, before APR.
 * A checked equation never certifies general factual correctness.
 */
export async function runCognitiveChat<T extends CognitiveModelAnswer>(options:CognitiveChatOptions<T>) {
  const {kernel,session,projectId,prompt,executionId}=options;
  const organizationId=session.identity.organization_id;
  if(!organizationId||!projectId||!/^exec_[a-f0-9-]{36}$/i.test(executionId))
    throw Error("COGNITIVE_SCOPE_INVALID");
  const team:TeamGraph={
    organization_id:organizationId,project_id:projectId,
    team_id:"osa.chat.cognitive.v1",version:"2",
    agents:[
      {agent_id:"nvidia",role:"Read-only chat worker",executor_ref:CHAT_EXECUTOR},
      {agent_id:"supervisor",role:"Independent deterministic review and bounded repair",executor_ref:SUPERVISOR_EXECUTOR},
    ],
    edges:[{edge_id:"worker-to-supervisor",from_agent_id:"nvidia",to_agent_id:"supervisor",kind:"handoff"}],
  };
  const mission:Mission={
    organization_id:organizationId,project_id:projectId,
    mission_id:"chat_"+executionId.slice(5),team_id:team.team_id,team_version:team.version,
    objective:prompt,entry_agent_id:"nvidia",input:{prompt},
    policy:{allowed_executor_refs:[CHAT_EXECUTOR,SUPERVISOR_EXECUTOR],required_receipts:[]},
    budget:{max_tasks:2,max_context_chars:12000},
    requirements:[
      {requirement_id:"provider_response_complete",type:"evidence_field_equals",
        agent_id:"nvidia",evidence_kind:"chat_provider_response",field:"complete",expected:true},
      {requirement_id:"supervisor_release",type:"evidence_field_equals",
        agent_id:"supervisor",evidence_kind:"chat_supervisor_release",field:"publishable",expected:true},
    ],
  };
  let answer:T|undefined;
  let supervisor:SupervisorRelease|undefined;
  const registry=new ExecutorRegistry();
  registry.register(CHAT_EXECUTOR,async()=>{
    answer=await options.complete();
    options.onAnswer?.(answer);
    return {output:answer.text,evidence:[{kind:"chat_provider_response",data:{
      complete:true,model:answer.model,provider_response_id:answer.provider_response_id,
      request_sha256:answer.request_sha256,response_sha256:hash(answer.text),
    },content:answer.text}]};
  });
  registry.register(SUPERVISOR_EXECUTOR,async context=>{
    if(!answer||typeof context.input!=="string"||context.input!==answer.text)
      throw Error("SUPERVISOR_HANDOFF_UNBOUND");
    const attempts:SupervisorAttempt[]=[];
    for(let attempt=1;attempt<=2;attempt++){
      if(!answer)throw Error("SUPERVISOR_MISSING_MODEL_ANSWER");
      const review=reviewChatCandidate(answer.text);
      attempts.push({attempt,response_sha256:hash(answer.text),
        provider_response_id:answer.provider_response_id,review});
      options.onSupervisor?.(review,attempt);
      if(review.verdict!=="FAIL"||attempt===2)break;
      const repair:SupervisorRepair={
        feedback:supervisorRepairFeedback(review),prior_response_sha256:hash(answer.text),
      };
      options.onRepair?.(repair);
      answer=await options.complete(repair);
      options.onAnswer?.(answer);
    }
    if(!answer)throw Error("SUPERVISOR_MISSING_MODEL_ANSWER");
    supervisor=sealSupervisorRelease(attempts,answer.text);
    return {output:answer.text,evidence:[{
      kind:"chat_supervisor_release",
      data:{
        publishable:supervisor.publishable,decision:supervisor.decision,
        content_verdict:supervisor.content_verdict,reason_code:supervisor.reason_code,
        repair_count:supervisor.repair_count,final_response_sha256:supervisor.final_response_sha256,
        attempts:supervisor.attempts,
      },
      content:JSON.stringify(supervisor),
    }]};
  });
  const {run,record}=await executeCognitiveMission(
    planningOnlyKernel(kernel,undefined,"REPORT_ONLY"),registry,team,mission,executionId,options.onPlanned);
  if(!answer||!supervisor||run.execution_id!==executionId||
     !record.brain?.planning_receipt)
    throw Error("COGNITIVE_EXECUTION_INTEGRITY_MISSING");
  if(supervisor.final_response_sha256!==hash(answer.text)||
     !run.evidence.some(e=>e.kind==="chat_supervisor_release"&&
       e.data.final_response_sha256===supervisor!.final_response_sha256))
    throw Error("SUPERVISOR_RECEIPT_UNBOUND");
  return {answer,supervisor,run,record};
}
