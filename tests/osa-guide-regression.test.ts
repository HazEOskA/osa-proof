import assert from "node:assert/strict";
import test from "node:test";
import { osaGuideContext, OSA_GUIDE_PAGES } from "../apps/api/src/osa-guide";
import { nvidiaComplete, NvidiaError } from "../apps/api/src/nvidia";

test("OSA guide: all known framework areas use allowlisted, concrete navigation context",()=>{
  const guide=osaGuideContext("trace");
  assert.match(guide,/Śledzenie/);
  assert.match(guide,/execution_id/);
  assert.match(guide,/ProofReceipt/);
  assert.ok(Object.keys(OSA_GUIDE_PAGES).length>30);
  for(const invalid of ["", "__proto__", "constructor", "not-real", "ops:unknown", "../secret", "x".repeat(200)]){
    assert.throws(()=>osaGuideContext(invalid),/INVALID_GUIDE_VIEW/);
  }
});

test("OSA guide: server model receives contextual guide without granting tools",async()=>{
 let outbound:any;
 const response=await nvidiaComplete("Pokaż przebieg misji",{
   NVIDIA_API_KEY:"test_key_0123456789",
   OSA_ZERO_COST_ONLY:"true",OSA_NVIDIA_FREE_TIER_ACK:"true",
 } as NodeJS.ProcessEnv,async(input,init)=>{
   assert.match(String(input),/^https:\/\/integrate\.api\.nvidia\.com/);
   outbound=JSON.parse(String(init?.body));
   return Response.json({id:"nvidia-mock",choices:[{message:{content:"Najpierw Śledzenie."},finish_reason:"stop"}]});
 },{agent:"guide",view:"trace",history:[{role:"user",content:"Pokaż historię."}]});
 assert.equal(response.status,"PROVIDER_RESPONSE");
 const system=outbound.messages[0].content;
 assert.match(system,/kontekstowym asystentem/);
 assert.match(system,/Śledzenie/);
 assert.match(system,/CLAIM/);
 assert.equal(outbound.messages.at(-1).content,"Pokaż przebieg misji");
 assert.equal(outbound.tools,undefined);
 assert.equal(outbound.tool_choice,undefined);
});
test("OSA guide: unrecognized view is refused before model network call",async()=>{
 let called=false;
 await assert.rejects(()=>nvidiaComplete("test",{NVIDIA_API_KEY:"test_key_0123456789"} as NodeJS.ProcessEnv,
 async()=>{called=true;throw Error("unexpected");},{agent:"guide",view:"not-a-real-module"}),e=>e instanceof NvidiaError && e.code==="INVALID_GUIDE_VIEW");
 assert.equal(called,false);
});
