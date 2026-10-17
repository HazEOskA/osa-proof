import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { protectedRuntime, openVercelAccess } from "./operator-access";
import { ModelQuotaError, sharedQuotaConfigured, takeModelQuota } from "./model-quota";
import type { executeUnified, UnifiedRequest } from "./unified";
import { osaGuideContext } from "./osa-guide";

export const NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
export class NvidiaError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function nvidiaStatus(env: NodeJS.ProcessEnv = process.env) {
  return { provider: "NVIDIA", configured: Boolean(env.NVIDIA_API_KEY?.trim()), model: env.NVIDIA_MODEL?.trim() || NVIDIA_MODEL };
}
export function nvidiaRequestConfig(options: { apiKey?: unknown; model?: unknown }, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const config = { ...env };
  if (options.apiKey !== undefined) {
    if (typeof options.apiKey !== "string" || !/^[A-Za-z0-9_.-]{10,4096}$/.test(options.apiKey.trim())) throw new NvidiaError(400, "INVALID_API_KEY", "Nieprawidłowy format klucza API NVIDIA.");
    config.NVIDIA_API_KEY = options.apiKey.trim();
  }
  if (options.model !== undefined) {
    if (typeof options.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(options.model) || options.model.length > 200) throw new NvidiaError(400, "INVALID_MODEL", "Wpisz identyfikator modelu w formacie dostawca/model.");
    config.NVIDIA_MODEL = options.model;
  }
  return config;
}
export function nvidiaCostGate(env: NodeJS.ProcessEnv, model = nvidiaStatus(env).model): void {
  // NVIDIA Build lists this exact model at the fixed integrate.api.nvidia.com
  // endpoint as a free API endpoint. No daily operator attestation is needed.
  // Source verified 2026-10-17: https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b
  if (model === NVIDIA_MODEL) return;
  if(protectedRuntime(env) && env.OSA_ZERO_COST_ONLY!=="true")
    throw new NvidiaError(403,"ZERO_COST_POLICY_REQUIRED","Model jest zablokowany: wymagana polityka zerowych kosztów.");
  if(env.OSA_ZERO_COST_ONLY!=="true") return;
  if(env.OSA_NVIDIA_FREE_TIER_ACK!=="true")
    throw new NvidiaError(403,"NVIDIA_COST_POLICY_BLOCKED","NVIDIA: wymagane potwierdzenie bezpłatnego dostępu przed wywołaniem modelu.");
  const allowed=(env.OSA_NVIDIA_FREE_MODELS||"").split(",").map(v=>v.trim()).filter(Boolean);
  const until=Date.parse(env.OSA_NVIDIA_FREE_UNTIL||"");
  if(!allowed.includes(model)||!Number.isFinite(until)||until<=Date.now()||until>Date.now()+24*60*60*1000)
    throw new NvidiaError(403,"NVIDIA_FREE_MODEL_UNVERIFIED","Brakuje aktualnego potwierdzenia bezpłatności wybranego modelu. Maksymalna ważność: 24 godziny.");
}
export function nvidiaAvailability(env:NodeJS.ProcessEnv) {
  try {nvidiaCostGate(env);} catch(error){return {available:false,gate:error instanceof NvidiaError?error.code:"UNKNOWN"};}
  if(!nvidiaStatus(env).configured)return {available:false,gate:"NVIDIA_NOT_CONFIGURED"};
  if(protectedRuntime(env)&&!openVercelAccess(env)&&!sharedQuotaConfigured(env))return {available:false,gate:"SHARED_QUOTA_NOT_CONFIGURED"};
  return {available:true,gate:null};
}
const NVIDIA_TOOLS = [{type:"function",function:{name:"osa_sha256",description:"Oblicza SHA-256 podanego tekstu przez autoryzowany OSA Runtime. Tylko odczyt, bez zmian plików i sieci.",
  parameters:{type:"object",properties:{text:{type:"string",maxLength:8000}},required:["text"],additionalProperties:false}}}];
export async function nvidiaComplete(prompt: unknown, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, context?: { agent?: unknown; history?: unknown; view?: unknown; tools?: boolean }) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000) throw new NvidiaError(400, "INVALID_PROMPT", "Wpisz prompt od 1 do 8000 znaków.");
  nvidiaCostGate(env);
  const key = env.NVIDIA_API_KEY?.trim();
  if (!key) throw new NvidiaError(503, "NVIDIA_NOT_CONFIGURED", "Dodaj NVIDIA_API_KEY w środowisku serwera.");
  // Use an explicit profile to guide the assistant; these are chat-only roles, never execution authority.
  const agents: Record<string,string> = {
    leader: "Jesteś Liderem floty OSA. Pomagasz planować, delegować w planie i analizować architekturę.",
    coding: "Jesteś Agentem programistycznym OSA. Doradzasz w projektowaniu kodu, testach i przeglądach. Nie deklaruj zapisania zmian.",
    commerce: "Jesteś Agentem handlu internetowego OSA. Pomagasz planować e-commerce, integracje i analitykę.",
    hermes: "Jesteś Hermesem OSA. Analizujesz możliwości ulepszeń, proponujesz zmiany. Nie wykonujesz ich samodzielnie.",
    security: "Jesteś Agentem bezpieczeństwa OSA. Analizujesz ryzyka, uprawnienia i kontrole dostępu.",
    research: "Jesteś Agentem badawczym OSA. Odróżniaj dowody od hipotez.",
    runtime: "Jesteś asystentem Runtime OSA. Wyjaśniasz tracing, proof i evidence bez wymyślania wykonania.",
    guide: "Jesteś OSĄ — kontekstowym przewodnikiem po frameworku i jego samouczkiem. Odpowiadaj krok po kroku i znaj dokładne moduły nawigacji."
  };
  const agent = context?.agent;
  if(agent !== undefined && (typeof agent !== "string" || !Object.hasOwn(agents,agent))) throw new NvidiaError(400,"INVALID_AGENT","Nieprawidłowy agent.");
  let guideContext = "";
  if (agent === "guide") {
    try { guideContext = osaGuideContext(context?.view); }
    catch { throw new NvidiaError(400,"INVALID_GUIDE_VIEW","Nieznany moduł przewodnika OSA."); }
  }
  const history = context?.history;
  if(history !== undefined && (!Array.isArray(history) || history.length > 8 ||
    history.some((m:unknown) => !m || typeof m !== "object" || !("role" in m) || !("content" in m) ||
      !["user","assistant"].includes(String(m.role)) || Object.keys(m).some(k=>!["role","content"].includes(k)) || typeof m.content !== "string" || m.content.length > 1800)))
    throw new NvidiaError(400,"INVALID_HISTORY","Historia rozmowy ma nieprawidłowy format lub przekracza limit.");
  const previous: {role:string;content:string}[] = Array.isArray(history) ? history.map(({role,content})=>({role,content})) : [];
  const model = nvidiaStatus(env).model;
  if(prompt.includes(key)||previous.some(m=>m.content.includes(key)))throw new NvidiaError(400,"SECRET_IN_PROMPT","Żądanie zawiera dane uwierzytelniające i zostało odrzucone.");
  if(context?.tools && agent==="guide")throw new NvidiaError(400,"GUIDE_TOOLS_DENIED","Przewodnik nie wykonuje narzędzi.");
  const started = Date.now();
  const requestBody = { model, stream:false, max_tokens:1024,
    ...(context?.tools?{tools:NVIDIA_TOOLS,tool_choice:"auto",parallel_tool_calls:false}:{}),
    messages:[{role:"system",content:"Jesteś asystentem ekosystemu OSA. Zawsze odpowiadaj po polsku. Nie twierdź, że wykonałeś operacje poza tą rozmową. Odpowiedź modelu nie jest dowodem wykonania." + (typeof agent==="string"?" "+agents[agent]:"") + (guideContext?" "+guideContext:"")},...previous,{role:"user",content:prompt.trim()}] };
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(25000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(requestBody) });
  } catch { throw new NvidiaError(504, "NVIDIA_UNAVAILABLE", "NVIDIA nie odpowiedziała w wymaganym czasie lub połączenie nie powiodło się."); }
  if (!response.ok) {
    throw new NvidiaError(response.status === 429 ? 429 : 502, "NVIDIA_REJECTED", response.status === 401 || response.status === 403 ? "NVIDIA odrzuciła autoryzację. Sprawdź klucz i dostęp do modelu." : response.status === 429 ? "Limit wywołań NVIDIA. Spróbuj później." : `NVIDIA odrzuciła żądanie (HTTP ${response.status}).`);
  }
  let data: {id?:string;model?:string;choices?:{message?:{content?:string;tool_calls?:unknown};finish_reason?:string}[]};
  try {
    const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
    if(reader)try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>256000){await reader.cancel();throw Error("TOO_LARGE");}chunks.push(next.value);}}finally{reader.releaseLock();}
    const raw=Buffer.concat(chunks).toString("utf8");
    if(raw.includes(key))throw Error("SECRET_IN_RESPONSE");
    data=JSON.parse(raw) as typeof data;
  }catch{throw new NvidiaError(502,"NVIDIA_INVALID_RESPONSE","NVIDIA zwróciła nieprawidłową odpowiedź.");}
  const message=data?.choices?.[0]?.message;
  const text=typeof message?.content==="string"?message.content:"";
  const calls=message?.tool_calls;
  let toolCall:{id:string;name:"osa_sha256";args:{text:string}}|null=null;
  if(calls!==undefined&&calls!==null){
    if(!context?.tools || !Array.isArray(calls) || calls.length!==1)
      throw new NvidiaError(502,"NVIDIA_TOOL_NOT_ALLOWED","Model zwrócił niedozwolone wywołanie narzędzia.");
    const c=calls[0];let args:unknown;
    try{args=JSON.parse(c?.function?.arguments);}catch{throw new NvidiaError(502,"NVIDIA_TOOL_ARGS_INVALID","Model zwrócił nieprawidłowe argumenty narzędzia.");}
    if(c?.type!=="function"||c?.function?.name!=="osa_sha256"||typeof c?.id!=="string"||!c.id||c.id.length>200||
       !args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).length!==1||typeof (args as {text?:unknown}).text!=="string"||(args as {text:string}).text.length>8000)
      throw new NvidiaError(502,"NVIDIA_TOOL_NOT_ALLOWED","Model zwrócił niedozwolone narzędzie lub argumenty.");
    toolCall={id:c.id,name:"osa_sha256",args:args as {text:string}};
  }
  if(!text.trim()&&!toolCall)throw new NvidiaError(502,"NVIDIA_EMPTY_RESPONSE","NVIDIA nie zwróciła treści odpowiedzi.");
  return {provider:"NVIDIA",model,reported_model:typeof data.model==="string"?data.model:null,text,request_id:randomUUID(),
    provider_response_id:typeof data.id==="string"?data.id:null,latency_ms:Date.now()-started,
    finish_reason:data.choices?.[0]?.finish_reason??null,status:"PROVIDER_RESPONSE",
    request_sha256:createHash("sha256").update(JSON.stringify(requestBody)).digest("hex"),
    response_sha256:createHash("sha256").update(JSON.stringify(data)).digest("hex"),tool_call:toolCall};
}

export async function handleNvidiaRequest(request: IncomingMessage, response: ServerResponse, path: string,
  options: {env?:NodeJS.ProcessEnv;dispatch?:(value:UnifiedRequest)=>ReturnType<typeof executeUnified>;fetch?:typeof fetch}={}) {
  const env=options.env??process.env,fetcher=options.fetch??fetch;
  const send = (status: number, data: unknown) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(data)); };
  if (path === "/nvidia/status" && request.method === "GET") return send(200, {...nvidiaStatus(env),...nvidiaAvailability(env),quota:sharedQuotaConfigured(env)?"SHARED":protectedRuntime(env)&&!openVercelAccess(env)?"SHARED_REQUIRED":"LOCAL_PROCESS_ONLY"});
  const fleet=path==="/nvidia/fleet-chat";
  if ((path !== "/nvidia/chat" && !fleet) || request.method !== "POST") return send(404, { error: "Trasa NVIDIA nie istnieje." });
  try {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 40000) throw new NvidiaError(413, "BODY_TOO_LARGE", "Żądanie jest za duże."); chunks.push(bytes); }
    let body: {prompt?:unknown;apiKey?:unknown;model?:unknown;agent?:unknown;view?:unknown;history?:unknown;execute_tools?:unknown;execution_id?:unknown};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NvidiaError(400, "INVALID_JSON", "Nieprawidłowy JSON."); }
    if(!body||typeof body!=="object"||Array.isArray(body))throw new NvidiaError(400,"INVALID_JSON","Wymagany jest obiekt JSON.");
    if(body.apiKey!==undefined)throw new NvidiaError(400,"SERVER_KEY_ONLY","Klucz NVIDIA jest konfigurowany wyłącznie na serwerze.");
    if(body.model!==undefined&&body.model!==nvidiaStatus(env).model)throw new NvidiaError(403,"MODEL_NOT_ALLOWED","Model musi być zatwierdzony w konfiguracji serwera.");
    if(body.execute_tools!==undefined&&typeof body.execute_tools!=="boolean")throw new NvidiaError(400,"INVALID_TOOL_MODE","Nieprawidłowy tryb narzędzi.");
    const useTools=fleet&&body.execute_tools===true;
    if(useTools&&(!options.dispatch||typeof body.execution_id!=="string"||!/^exec_[a-f0-9-]{36}$/.test(body.execution_id)))throw new NvidiaError(400,"INVALID_EXECUTION_ID","Brakuje prawidłowego identyfikatora wykonania.");
    nvidiaCostGate(env);
    if(!nvidiaStatus(env).configured)throw new NvidiaError(503,"NVIDIA_NOT_CONFIGURED","Brak konfiguracji NVIDIA na serwerze.");
    await takeModelQuota(env,randomUUID(),fetcher);
    const answer=await nvidiaComplete(body.prompt,env,fetcher,fleet?{agent:body.agent,history:body.history,view:body.view,tools:useTools}:undefined);
    if(answer.tool_call){
      if(!answer.provider_response_id||!answer.reported_model)throw new NvidiaError(502,"MODEL_PROVENANCE_MISSING","Brakuje identyfikatora odpowiedzi lub modelu dostawcy. Narzędzie nie zostało wykonane.");
      // Only a provider-returned, validated tool_call can enter this branch. No prompt router.
      const bundle=await options.dispatch!({message:String(body.prompt),execution_id:body.execution_id as string,
        tool:"osa.crypto.sha256.v1",args:answer.tool_call.args,selection:{provider:"nvidia",model:answer.model,
          reported_model:answer.reported_model,response_sha256:answer.response_sha256,request_sha256:answer.request_sha256,
          response_id:answer.provider_response_id,tool_call_id:answer.tool_call.id,source:"SERVER_OBSERVED_PROVIDER_RESPONSE"}});
      return send(200,{...answer,status:bundle.status==="EXECUTED"?"TOOL_EXECUTED":"TOOL_BLOCKED",bundle});
    }
    return send(200,answer);
  } catch (error) {
    if (error instanceof NvidiaError||error instanceof ModelQuotaError) return send(error.status, { error: error.message, code: error.code });
    return send(500, { error: "Błąd mostu NVIDIA.", code: "NVIDIA_INTERNAL_ERROR" });
  }
}
