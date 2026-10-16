import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

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
export async function nvidiaComplete(prompt: unknown, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, context?: { agent?: unknown; history?: unknown }) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000) throw new NvidiaError(400, "INVALID_PROMPT", "Wpisz prompt od 1 do 8000 znaków.");
  if(env.OSA_ZERO_COST_ONLY==="true"&&env.OSA_NVIDIA_FREE_TIER_ACK!=="true")
    throw new NvidiaError(403,"NVIDIA_COST_POLICY_BLOCKED","NVIDIA: wymagane potwierdzenie bezpłatnego dostępu przed wywołaniem modelu.");
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
    runtime: "Jesteś asystentem Runtime OSA. Wyjaśniasz tracing, proof i evidence bez wymyślania wykonania."
  };
  const agent = context?.agent;
  if(agent !== undefined && (typeof agent !== "string" || !Object.hasOwn(agents,agent))) throw new NvidiaError(400,"INVALID_AGENT","Nieprawidłowy agent.");
  const history = context?.history;
  if(history !== undefined && (!Array.isArray(history) || history.length > 8 ||
    history.some((m:unknown) => !m || typeof m !== "object" || !("role" in m) || !("content" in m) ||
      !["user","assistant"].includes(String(m.role)) || typeof m.content !== "string" || m.content.length > 1800)))
    throw new NvidiaError(400,"INVALID_HISTORY","Historia rozmowy ma nieprawidłowy format lub przekracza limit.");
  const previous: {role:string;content:string}[] = Array.isArray(history) ? history : [];
  const model = nvidiaStatus(env).model;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(25000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, stream: false, max_tokens: 1024, messages: [{ role: "system", content: "Jesteś asystentem ekosystemu OSA. Zawsze odpowiadaj po polsku. Nie twierdź, że wykonałeś operacje poza tą rozmową. Odpowiedź modelu nie jest dowodem wykonania." + (typeof agent==="string" ? " "+agents[agent] : "") }, ...previous, { role: "user", content: prompt.trim() }] }) });
  } catch { throw new NvidiaError(504, "NVIDIA_UNAVAILABLE", "NVIDIA nie odpowiedziała w wymaganym czasie lub połączenie nie powiodło się."); }
  if (!response.ok) {
    throw new NvidiaError(response.status === 429 ? 429 : 502, "NVIDIA_REJECTED", response.status === 401 || response.status === 403 ? "NVIDIA odrzuciła autoryzację. Sprawdź klucz i dostęp do modelu." : response.status === 429 ? "Limit wywołań NVIDIA. Spróbuj później." : `NVIDIA odrzuciła żądanie (HTTP ${response.status}).`);
  }
  let data: { id?: string; choices?: { message?: { content?: string }; finish_reason?: string }[] };
  try { data = await response.json() as typeof data; } catch { throw new NvidiaError(502, "NVIDIA_INVALID_RESPONSE", "NVIDIA zwróciła nieprawidłową odpowiedź."); }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new NvidiaError(502, "NVIDIA_EMPTY_RESPONSE", "NVIDIA nie zwróciła treści odpowiedzi.");
  return { provider: "NVIDIA", model, text, request_id: randomUUID(), provider_response_id: typeof data.id === "string" ? data.id : null, latency_ms: Date.now() - started, finish_reason: data.choices?.[0]?.finish_reason ?? null, status: "PROVIDER_RESPONSE" };
}

// Per-instance ceiling; deployment protection provides the outer authenticated preview boundary.
const fleetCalls:number[] = [];
function fleetLimit() {
  const now=Date.now();
  for(let i=fleetCalls.length-1;i>=0;i--)if(now-fleetCalls[i]>60*60*1000)fleetCalls.splice(i,1);
  if(fleetCalls.length>=30 || fleetCalls.filter(t=>now-t<60*1000).length>=3)
    throw new NvidiaError(429,"FLEET_RATE_LIMIT","Limit żądań modelu: maksymalnie 3/min oraz 30/godz. dla tej instancji.");
  fleetCalls.push(now);
}
export async function handleNvidiaRequest(request: IncomingMessage, response: ServerResponse, path: string) {
  const send = (status: number, data: unknown) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(data)); };
  if (path === "/nvidia/status" && request.method === "GET") return send(200, nvidiaStatus());
  const fleet=path==="/nvidia/fleet-chat";
  if ((path !== "/nvidia/chat" && !fleet) || request.method !== "POST") return send(404, { error: "Trasa NVIDIA nie istnieje." });
  try {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 40000) throw new NvidiaError(413, "BODY_TOO_LARGE", "Żądanie jest za duże."); chunks.push(bytes); }
    let body: { prompt?: unknown; apiKey?: unknown; model?: unknown; agent?: unknown; history?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NvidiaError(400, "INVALID_JSON", "Nieprawidłowy JSON."); }
    if(fleet){if(body.apiKey!==undefined)throw new NvidiaError(400,"FLEET_SERVER_KEY_ONLY","Czat floty korzysta wyłącznie z klucza serwera."); fleetLimit();}
    return send(200, await nvidiaComplete(body?.prompt, nvidiaRequestConfig(fleet ? {} : body ?? {}),fetch, fleet ? {agent:body?.agent,history:body?.history} : undefined));
  } catch (error) {
    if (error instanceof NvidiaError) return send(error.status, { error: error.message, code: error.code });
    return send(500, { error: "Błąd mostu NVIDIA.", code: "NVIDIA_INTERNAL_ERROR" });
  }
}
