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
export async function nvidiaComplete(prompt: unknown, env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000) throw new NvidiaError(400, "INVALID_PROMPT", "Wpisz prompt od 1 do 8000 znaków.");
  const key = env.NVIDIA_API_KEY?.trim();
  if (!key) throw new NvidiaError(503, "NVIDIA_NOT_CONFIGURED", "Dodaj NVIDIA_API_KEY w środowisku serwera.");
  const model = nvidiaStatus(env).model;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(25000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, stream: false, max_tokens: 1024, messages: [{ role: "system", content: "Jesteś asystentem OSA. Odpowiadaj po polsku. Nie twierdź, że wykonałeś operacje poza tą rozmową." }, { role: "user", content: prompt.trim() }] }) });
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

export async function handleNvidiaRequest(request: IncomingMessage, response: ServerResponse, path: string) {
  const send = (status: number, data: unknown) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(data)); };
  if (path === "/nvidia/status" && request.method === "GET") return send(200, nvidiaStatus());
  if (path !== "/nvidia/chat" || request.method !== "POST") return send(404, { error: "Trasa NVIDIA nie istnieje." });
  try {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 40000) throw new NvidiaError(413, "BODY_TOO_LARGE", "Żądanie jest za duże."); chunks.push(bytes); }
    let body: { prompt?: unknown };
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NvidiaError(400, "INVALID_JSON", "Nieprawidłowy JSON."); }
    return send(200, await nvidiaComplete(body?.prompt));
  } catch (error) {
    if (error instanceof NvidiaError) return send(error.status, { error: error.message, code: error.code });
    return send(500, { error: "Błąd mostu NVIDIA.", code: "NVIDIA_INTERNAL_ERROR" });
  }
}
