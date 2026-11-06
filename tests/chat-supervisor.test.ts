import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runCognitiveChat } from "../apps/api/src/chat-cognitive";
import { MissionKernel } from "../packages/runtime/src";
import { verifyMissionExecution, verifyCompletedMission } from "../packages/proof-core/src";
import {
  reviewChatCandidate,sealSupervisorRelease,supervisorRepairFeedback,
} from "../packages/supervisor-adapter/src/chat-supervisor";
import type { SessionRecord } from "../packages/contracts/src";

const session={identity:{organization_id:"org_supervisor",identity_id:"tester"}} as SessionRecord;
const eid=()=> "exec_"+randomUUID();
const model=(text:string,id:string)=>({text,model:"nvidia/mock",provider_response_id:id,request_sha256:"a".repeat(64)});

test("Supervisor checks arbitrary explicit equalities without a commerce parser",()=>{
  for(const text of ["2 + 2 = 4","18 000 zł – 30 000 zł = –12 000 zł","81 000 - 30 000 - 53 000 - 8 000 - 2 000 = -12 000"]){
    const r=reviewChatCandidate(text);
    assert.equal(r.verdict,"PASS",text);
    assert.equal(r.checks.length,1,text);
  }
  const bad=reviewChatCandidate("2+2=5");
  assert.equal(bad.verdict,"FAIL");
  assert.equal(bad.checks[0].reason,"ARITHMETIC_MISMATCH");
  assert.equal(bad.checks[0].expected,"4");
  assert.match(supervisorRepairFeedback(bad),/4/);
  assert.equal(reviewChatCandidate("Klient mieszka w Holandii i reklamuje produkt.").verdict,"UNKNOWN");
  assert.equal(reviewChatCandidate("Dzielenie przez zero: 3 / 0 = 0").verdict,"UNKNOWN");
});
test("Supervisor release cannot be fabricated from a mismatched candidate SHA",()=>{
  const r=reviewChatCandidate("2 + 2 = 4");
  assert.throws(()=>sealSupervisorRelease([{attempt:1,provider_response_id:"test",response_sha256:"f".repeat(64),review:r}],"2 + 2 = 4"),/INTEGRITY/);
});

test("E2E: Worker -> Supervisor FAIL -> one repair -> Supervisor PASS -> APR bound receipt",async()=>{
  const responses=[model("2+2=5","first"),model("2+2=4","fixed")];
  let index=0;
  const reviews:string[]=[];
  const feedback:string[]=[];
  const kernel=new MissionKernel();
  const executionId=eid();
  const {answer,supervisor,run,record}=await runCognitiveChat({
    kernel,session,projectId:"project_supervisor",prompt:"Ile to 2+2?",executionId,
    complete:async repair=>{
      if(index===1){assert.ok(repair);assert.match(repair.feedback,/4/);assert.match(repair.prior_response_sha256,/^[0-9a-f]{64}$/);}
      return responses[index++]!;
    },
    onSupervisor:(review,attempt)=>reviews.push(attempt+":"+review.verdict),
    onRepair:repair=>feedback.push(repair.feedback),
  });
  assert.equal(index,2);
  assert.deepEqual(reviews,["1:FAIL","2:PASS"]);
  assert.equal(feedback.length,1);
  assert.equal(answer.text,"2+2=4");
  assert.equal(supervisor.decision,"RELEASED");
  assert.equal(supervisor.publishable,true);
  assert.equal(supervisor.repair_count,1);
  assert.equal(run.verdict,"VERIFIED");
  assert.equal(record.state,"COMPLETED");
  assert.equal(run.final_output,answer.text);
  assert.equal(run.proof.requirement_verdicts.find(r=>r.requirement_id==="supervisor_release")?.verdict,"VERIFIED");
  assert.equal(run.events.filter(e=>e.type==="HANDOFF_CREATED").length,1);
  assert.deepEqual(run.events.filter(e=>e.type==="AGENT_COMPLETED").map(e=>e.agent_id),["nvidia","supervisor"]);
  assert.ok(run.evidence.find(e=>e.kind==="chat_supervisor_release"&&e.agent_id==="supervisor"&&e.data.repair_count===1));
  assert.doesNotThrow(()=>verifyMissionExecution(record.team,record.mission,run,{trustedClaimEnforcement:"REPORT_ONLY"}));
  assert.doesNotThrow(()=>verifyCompletedMission(record,{trustedClaimEnforcement:"REPORT_ONLY"}));
});
test("E2E: two wrong attempts => no release, APR FAIL and no infinite loop",async()=>{
  const replies=[model("Wynik: 2+2=5","bad-1"),model("Wynik: 2+2=6","bad-2")];
  let attempts=0;
  const {supervisor,run,record}=await runCognitiveChat({
    kernel:new MissionKernel(),session,projectId:"project_supervisor",prompt:"2+2?",executionId:eid(),
    complete:async()=>replies[attempts++]!,
  });
  assert.equal(attempts,2);
  assert.equal(supervisor.decision,"REJECTED");
  assert.equal(supervisor.publishable,false);
  assert.equal(supervisor.reason_code,"REPAIR_EXHAUSTED");
  assert.equal(run.verdict,"FAILED");
  assert.equal(record.state,"FAILED");
  assert.equal(run.proof.requirement_verdicts.find(r=>r.requirement_id==="supervisor_release")?.verdict,"FAILED");
  assert.equal(run.evidence.find(e=>e.kind==="chat_supervisor_release")?.data.publishable,false);
  assert.doesNotThrow(()=>verifyMissionExecution(record.team,record.mission,run,{trustedClaimEnforcement:"REPORT_ONLY"}));
});
test("E2E: UNKNOWN permits a labeled response but never implies content certainty",async()=>{
  let calls=0;
  const {answer,supervisor,run}=await runCognitiveChat({
    kernel:new MissionKernel(),session,projectId:"project_supervisor",prompt:"Wyjaśnij historię Rzymu",executionId:eid(),
    complete:async()=>{calls++;return model("Wymaga sprawdzenia źródeł historycznych.","plain");},
  });
  assert.equal(calls,1);
  assert.equal(supervisor.content_verdict,"UNKNOWN");
  assert.equal(supervisor.reason_code,"UNVERIFIED_CONTENT");
  assert.equal(run.verdict,"VERIFIED");
  assert.equal(answer.text,"Wymaga sprawdzenia źródeł historycznych.");
  assert.equal(supervisor.publishable,true);
});
