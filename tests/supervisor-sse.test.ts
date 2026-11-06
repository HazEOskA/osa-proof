import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ApiState, createApiServer } from "../apps/api/src";
import { ExecutorRegistry } from "../packages/runtime/src";
const executionId=()=>"exec_"+randomUUID();
test("P0 SSE: repair is real NVIDIA retry; Supervisor controls release before APR",async()=>{
  const state=new ApiState(undefined,undefined,undefined,"open");
  const user=state.sessions.create({identity_id:"supervisor_sse",provider:"microsoft",subject:"supervisor_sse",
    display_name:"Supervisor tester",organization_id:"org_p0",project_ids:["project_chat_delivery"],
    roles:[],verified:true});
  const server=createApiServer(new ExecutorRegistry(),state);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
  const originalFetch=globalThis.fetch;
  const originalKey=process.env.NVIDIA_API_KEY,originalCost=process.env.OSA_ZERO_COST_ONLY;
  process.env.NVIDIA_API_KEY="test-provider-key";
  process.env.OSA_ZERO_COST_ONLY="false";
  let requests:Array<Record<string,any>>=[];
  let outputs=["Rachunek: 2+2=5","Rachunek: 2+2=4"];
  globalThis.fetch=async(url,init)=>{
    if(String(url)!=="https://integrate.api.nvidia.com/v1/chat/completions")return originalFetch(url,init);
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({id:"provider-supervisor-"+requests.length,model:"nvidia/test-provider",
      choices:[{message:{content:outputs[requests.length-1]},finish_reason:"stop"}]});
  };
  try{
    const frames=(stream:string,type:string)=>stream.split("\n\n").filter(p=>p.startsWith("event: "+type+"\n"))
      .map(p=>JSON.parse(p.split("\n").find(l=>l.startsWith("data: "))!.slice(6)) as Record<string,any>);
    const ask=async()=>{
      const execution_id=executionId(),conversation_id=randomUUID();
      const response=await originalFetch(base+"/nvidia/fleet-live",{method:"POST",
        headers:{authorization:"Bearer "+user.token,origin:base,"content-type":"application/json"},
        body:JSON.stringify({prompt:"Ile to 2+2? Pokaż równanie.",agent:"jeverson",history:[],remember:false,execution_id,conversation_id})});
      assert.equal(response.status,200);
      return {execution_id,stream:await response.text()};
    };
    const good=await ask();
    assert.equal(requests.length,2);
    assert.equal(requests[0].messages.some((m:any)=>String(m.content).includes("Supervisor wykrył")),false);
    assert.equal(requests[1].messages.some((m:any)=>String(m.content).includes("Supervisor wykrył")),true);
    assert.equal(frames(good.stream,"error").length,0);
    assert.equal(frames(good.stream,"review").length,0);
    assert.equal(frames(good.stream,"complete")[0].text,"Rachunek: 2+2=4");
    assert.equal(frames(good.stream,"complete")[0].supervisor.decision,"RELEASED");
    assert.equal(frames(good.stream,"complete")[0].supervisor.repair_count,1);
    assert.ok(frames(good.stream,"trace").some(t=>t.phase==="supervisor_repair_started"));
    const audit=frames(good.stream,"audit")[0];
    assert.equal(audit.supervisor.attempts.length,2);
    assert.equal(audit.supervisor.attempts[0].review.verdict,"FAIL");
    assert.equal(audit.supervisor.attempts[1].review.verdict,"PASS");
    assert.equal(audit.execution_verdict,"VERIFIED");
    assert.equal(audit.proof.requirement_verdicts.find((v:any)=>v.requirement_id==="supervisor_release").verdict,"VERIFIED");

    requests=[];outputs=["Rachunek: 2+2=5","Rachunek: 2+2=6"];
    const rejected=await ask();
    assert.equal(requests.length,2);
    assert.equal(frames(rejected.stream,"complete").length,0);
    assert.equal(frames(rejected.stream,"audit").length,0);
    const error=frames(rejected.stream,"error")[0],review=frames(rejected.stream,"review")[0];
    assert.equal(error.code,"SUPERVISOR_REPAIR_EXHAUSTED");
    assert.equal(review.supervisor.decision,"REJECTED");
    assert.equal(review.supervisor.attempts.length,2);
    assert.equal(review.proof.verdict,"FAILED");
    assert.equal(review.proof.requirement_verdicts.find((v:any)=>v.requirement_id==="supervisor_release").verdict,"FAILED");
    assert.ok(frames(rejected.stream,"trace").some(t=>t.phase==="supervisor_rejected"));
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=originalKey;
    if(originalCost===undefined)delete process.env.OSA_ZERO_COST_ONLY;else process.env.OSA_ZERO_COST_ONLY=originalCost;
  }
});
