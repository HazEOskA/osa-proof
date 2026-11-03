import { createHash } from "node:crypto";
import type { BrainMemoryContext, EvidenceInput } from "../../../packages/contracts/src";
import type { DemoRequest } from "../../../packages/demo-team/src";
import { inspectArtifact, normalizeGeneratedArtifact } from "../../../packages/demo-team/src";
import { fleetLimit, nvidiaComplete } from "./nvidia";

const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
const DEFAULT_ARTIFACT_MODEL="openai/gpt-oss-20b";
export type ModelComplete=typeof nvidiaComplete;
export async function generateNvidiaArtifact(
  spec:DemoRequest,env:NodeJS.ProcessEnv,memoryContext?:BrainMemoryContext,
  complete:ModelComplete=nvidiaComplete,reserveCall:()=>void=fleetLimit,executionId?:string
):Promise<{content:string;evidence:EvidenceInput[]}>{
  if(spec.kind!=="webapp" && spec.kind!=="document")throw Error("UNSUPPORTED_ARTIFACT");
  const kind=spec.kind;
  const runtimeEnv={...env,NVIDIA_MODEL:env.OSA_DELIVERY_MODEL?.trim()||DEFAULT_ARTIFACT_MODEL,OSA_ZERO_COST_ONLY:"true"};
  const ctx={agent:"coding",artifact:kind,...(memoryContext?{memory:memoryContext}:{})};
  // The objective is untrusted requirements/data. A webapp request must produce an app, not prose.
  const firstPrompt=kind==="webapp"
    ? "Wygeneruj wyłącznie kompletną, samodzielną aplikację HTML po polsku prezentującą poniższy cel. Jeśli cel dotyczy audytu lub analizy, zbuduj interaktywny dashboard z podanymi liczbami i jawnie oznaczonymi brakami danych; nie oddawaj raportu tekstowego. Doctype, html, head, title, body, CSS, JS, wszystkie tagi zamknięte. CEL:\n"+spec.objective
    : spec.objective;
  const first=await complete(firstPrompt,runtimeEnv,fetch,ctx);
  let chosen=first,content=normalizeGeneratedArtifact(first.text,kind);
  let attempts=1;
  if(kind==="webapp"){
    const valid=(c:string)=>inspectArtifact({name:"index.html",media_type:"text/html",
      content:c,bytes:Buffer.byteLength(c),sha256:sha(c)},kind).length===0;
    if(!valid(content)){
      // At most one additional provider call; strictly charge the existing per-instance fleet limit.
      reserveCall();
      const repairPrompt="Ponów generowanie kompletnej aplikacji HTML od początku. Poprzednia odpowiedź miała niepoprawną strukturę HTML. Zwróć WYŁĄCZNIE jeden skończony dokument <!doctype html><html>...<head><title>...</title></head><body>...</body></html>, bez komentarza i bez Markdown. Zawrzyj CSS i JavaScript inline, bez zależności sieciowych. Nie wymyślaj brakujących danych. CEL:\n"+spec.objective;
      chosen=await complete(repairPrompt,runtimeEnv,fetch,ctx);
      content=normalizeGeneratedArtifact(chosen.text,kind);
      attempts=2;
    }
  }
  // No HTML is manufactured: invalid second output will FAIL the real inspector.
  if(!content.trim()||Buffer.byteLength(content)>128*1024)throw Error("ARTIFACT_SIZE_INVALID");
  return {content,evidence:[{kind:"model_artifact_generation",data:{
    provider:chosen.provider,model:chosen.model,request_id:chosen.request_id,
    provider_response_id:chosen.provider_response_id,request_sha256:chosen.request_sha256,
    response_sha256:sha(chosen.text),initial_response_sha256:sha(first.text),
    output_content_sha256:sha(content),normalization_applied:content!==chosen.text.trim(),
    attempt_count:attempts,repair_attempted:attempts===2,latency_ms:chosen.latency_ms,
    ...(executionId?{execution_id:executionId}:{}),
    ...(memoryContext?{memory_context_sha256:memoryContext.context_sha256,
      memory_brain_id:memoryContext.brain_id,memory_ledger_head:memoryContext.ledger_head}:{})
  }}]};
}
