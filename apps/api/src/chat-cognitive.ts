import { createHash } from "node:crypto";
import type { Mission, SessionRecord, TeamGraph } from "../../../packages/contracts/src";
import { ExecutorRegistry, MissionKernel } from "../../../packages/runtime/src";
import { executeCognitiveMission } from "./cognitive-execution";

const CHAT_EXECUTOR = "osa.chat.nvidia.v1";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type CognitiveModelAnswer = {
  text: string;
  model: string;
  provider_response_id: string | null;
  request_sha256: string;
};
export type CognitiveChatOptions<T extends CognitiveModelAnswer> = {
  kernel: MissionKernel;
  session: SessionRecord;
  projectId: string;
  prompt: string;
  executionId: string;
  complete: () => Promise<T>;
  onPlanned?: () => void;
  onAnswer?: (answer: T) => void;
};

/**
 * Conversation is an actual one-task Mission. An approved Brain plan is required
 * before provider execution. APR always checks its output and binds evidence.
 * Neither a planning receipt nor a verified execution implies factual truth.
 */
export async function runCognitiveChat<T extends CognitiveModelAnswer>(options: CognitiveChatOptions<T>) {
  const {kernel, session, projectId, prompt, executionId} = options;
  const organizationId = session.identity.organization_id;
  if (!organizationId || !projectId || !/^exec_[a-f0-9-]{36}$/i.test(executionId))
    throw Error("COGNITIVE_SCOPE_INVALID");
  const team: TeamGraph = {
    organization_id: organizationId,
    project_id: projectId,
    team_id: "osa.chat.cognitive.v1",
    version: "1",
    agents: [{agent_id:"nvidia",role:"Read-only chat model executor",executor_ref:CHAT_EXECUTOR}],
    edges:[],
  };
  const mission: Mission = {
    organization_id: organizationId,
    project_id: projectId,
    mission_id: "chat_" + executionId.slice(5),
    team_id: team.team_id,
    team_version: team.version,
    objective: prompt,
    entry_agent_id: "nvidia",
    input: {prompt},
    policy:{allowed_executor_refs:[CHAT_EXECUTOR],required_receipts:[]},
    budget:{max_tasks:1,max_context_chars:12000},
    requirements:[{requirement_id:"provider_response_complete",type:"evidence_field_equals",
      agent_id:"nvidia",evidence_kind:"chat_provider_response",field:"complete",expected:true}],
  };
  let answer: T | undefined;
  const registry = new ExecutorRegistry();
  registry.register(CHAT_EXECUTOR, async () => {
    answer = await options.complete();
    options.onAnswer?.(answer);
    return {
      output: answer.text,
      evidence: [{kind:"chat_provider_response",data:{
        complete:true,model:answer.model,provider_response_id:answer.provider_response_id,
        request_sha256:answer.request_sha256,response_sha256:hash(answer.text),
      },content:answer.text}],
    };
  });
  const {run,record} = await executeCognitiveMission(kernel,registry,team,mission,executionId,options.onPlanned);
  if (!answer || run.execution_id !== executionId || !record.brain?.planning_receipt)
    throw Error("COGNITIVE_EXECUTION_INTEGRITY_MISSING");
  return {answer,run,record};
}
