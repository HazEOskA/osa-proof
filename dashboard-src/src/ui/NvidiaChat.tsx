import { useEffect, useId, useState } from "react";

interface Reply { text: string; model: string; provider_response_id: string | null; request_id: string; latency_ms: number }
const headers = () => {
  const token = sessionStorage.getItem("osa.web3.session")?.trim();
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/nvidia/${path}`, { ...init, headers: headers(), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Błąd HTTP ${response.status}`);
  return body as T;
}
export default function NvidiaChat() {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; request<{ configured: boolean; model: string }>("status").then(value => { if (active) setStatus(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setReply(null);
    try { setReply(await request<Reply>("chat", { method: "POST", body: JSON.stringify({ prompt }) })); }
    catch (e) { setError(e instanceof Error ? e.message : "Wywołanie nie powiodło się."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 py-2 text-[12px]">
    <p className="text-dim">{status ? status.configured ? `Klucz skonfigurowany · ${status.model}` : "Brak NVIDIA_API_KEY na serwerze." : "Sprawdzam konfigurację…"}</p>
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={promptId} className="block">Polecenie dla NVIDIA</label>
      <textarea id={promptId} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={8000} rows={4} required className="focus-ring w-full rounded border border-line bg-panel p-2" placeholder="Napisz, czego potrzebujesz…" />
      <button disabled={busy || !prompt.trim() || !status?.configured} className="focus-ring tap rounded border border-line px-3 disabled:opacity-40">{busy ? "Generuję…" : "Wyślij do NVIDIA"}</button>
    </form>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {reply && <div aria-live="polite"><p className="whitespace-pre-wrap break-words">{reply.text}</p><p className="mono mt-3 break-all text-[10px] text-dim">{reply.model} · {reply.latency_ms} ms · odpowiedź: {reply.provider_response_id || "brak ID dostawcy"} · żądanie: {reply.request_id}</p></div>}
  </div>;
}
