import test from "node:test";
import assert from "node:assert/strict";
import { generateNvidiaArtifact } from "../apps/api/src/artifact-generation";
import { inspectArtifact } from "../packages/demo-team/src";
import { createHash } from "node:crypto";
import type { DemoRequest } from "../packages/demo-team/src";
import type { ModelComplete } from "../apps/api/src/artifact-generation";
const spec:DemoRequest={objective:"OSA Commerce: A koszt 1200 przychód 6000 marża 40%, CPA 30→48; B koszt 1800 przychód 3000 marża 35%, CPA 45→70; C koszt 900, przychód NIEZNANY, CPA 20→24. Pokaż wynik, braki danych, DRAFT i pilot 10 przypadków.",kind:"webapp",mode:"connected",target:"artifact"};
const html='<!doctype html><html lang="pl"><head><meta charset="utf-8"><title lang="pl">OSA Commerce Decision</title></head><body><main><h1>A / B / C</h1><p>Brak przychodu C. DRAFT do zatwierdzenia.</p></main></body></html>';
const complete=(replies:string[],seen:string[]) => (async(prompt:unknown)=>{
  seen.push(String(prompt));
  const text=replies.shift();
  if(!text)throw Error("UNEXPECTED_PROVIDER_CALL");
  return {provider:"NVIDIA",model:"openai/gpt-oss-20b",text,
    request_id:"fixture-id",provider_response_id:"provider-fixture",request_sha256:"fixture",
    latency_ms:1,finish_reason:"stop",status:"PROVIDER_RESPONSE"} as const;
}) as unknown as ModelComplete;
test("P0 commerce demo: HTML returned with Markdown commentary extracts genuine complete bytes and passes Proof structural gate",async()=>{
  const seen:string[]=[],mock=complete(["Raport dla kampanii:\n\x60\x60\x60html\n"+html+"\n\x60\x60\x60"],seen);
  const x=await generateNvidiaArtifact(spec,{NVIDIA_API_KEY:"unit",OSA_NVIDIA_FREE_TIER_ACK:"true"},undefined,mock,()=>{throw Error("NO_SECOND_CALL");});
  assert.equal(x.content,html);assert.equal(seen.length,1);
  assert.match(seen[0],/dashboard/);
  assert.match(x.content,/NIEZNANY|Brak przychodu/);
  const artifact={name:"index.html",media_type:"text/html",content:x.content,
    bytes:Buffer.byteLength(x.content),sha256:createHash("sha256").update(x.content).digest("hex")};
  assert.deepEqual(inspectArtifact(artifact,"webapp"),[]);
  const evidence=x.evidence[0].data as Record<string,unknown>;
  assert.equal(evidence.attempt_count,1);assert.equal(evidence.normalization_applied,true);
});
test("P0 commerce demo: incomplete HTML gets at most one rate-limited re-generation with intact evidence",async()=>{
  const seen:string[]=[],mock=complete(["Wyniki A/B/C: opis zamiast HTML",html],seen);
  let reserved=0;
  const x=await generateNvidiaArtifact(spec,{NVIDIA_API_KEY:"unit"},undefined,mock,()=>{reserved++});
  assert.equal(x.content,html);assert.equal(seen.length,2);assert.equal(reserved,1);
  const evidence=x.evidence[0].data as Record<string,unknown>;
  assert.equal(evidence.attempt_count,2);assert.equal(evidence.repair_attempted,true);
  assert.notEqual(evidence.initial_response_sha256,evidence.response_sha256);
});
test("P0 commerce demo: second incomplete HTML never passes and provider is not retried again",async()=>{
  const seen:string[]=[],mock=complete(["Pierwszy opis","Drugi opis"],seen);
  const x=await generateNvidiaArtifact(spec,{NVIDIA_API_KEY:"unit"},undefined,mock,()=>{});
  assert.equal(seen.length,2);
  const content=x.content;
  const artifact={name:"index.html",media_type:"text/html",content,bytes:Buffer.byteLength(content),
    sha256:createHash("sha256").update(content).digest("hex")};
  assert.ok(inspectArtifact(artifact,"webapp").includes("Standalone HTML document required."));
});
