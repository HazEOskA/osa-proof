import assert from "node:assert/strict";
import test from "node:test";
import { nvidiaComplete } from "../apps/api/src/nvidia";
for (const [agent,label] of [["jeverson","Jeversonem"],["hermes","Hermesem"]] as const) {
  test(`OSA agent ${agent} uses its own model role, without a paid provider call`,async()=>{
    let calls=0;
    const answer=await nvidiaComplete("Witaj",{NVIDIA_API_KEY:"example-provider-key"},async(_url,init)=>{
      calls++;
      const request=JSON.parse(String(init?.body));
      assert.match(request.messages[0].content,new RegExp(label));
      return Response.json({id:"fixture",choices:[{message:{content:"Odpowiedź testowa"}}]});
    },{agent,history:[]});
    assert.equal(calls,1);assert.equal(answer.status,"PROVIDER_RESPONSE");
  });
}
