import { useEffect, useState } from "react";
import { requestJson } from "../data/data";
import { canon, sha256 } from "../lib/verify";
import GithubLogin, { useGithubSession } from "./GithubLogin";

export interface MemoryStatus {
  state: "UNCONFIGURED" | "ACCESS_REQUIRED" | "AVAILABLE" | "UNAVAILABLE";
  message: string;
  checked_at?: string;
  brain_id?: string;
  persistence_verified: boolean;
}
const LABEL: Record<MemoryStatus["state"], string> = {
  UNCONFIGURED: "Pamięć niepołączona", ACCESS_REQUIRED: "Pamięć wymaga dostępu",
  AVAILABLE: "Pamięć odpowiada", UNAVAILABLE: "Pamięć niedostępna",
};
export function useMemoryStatus() {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [error, setError] = useState("");
  async function refresh() {
    try { setStatus(await requestJson<MemoryStatus>("/memory/status")); setError(""); }
    catch { setStatus(null); setError("Nie udało się sprawdzić stanu pamięci."); }
  }
  useEffect(() => { void refresh(); }, []);
  return { status, error, refresh };
}
export function MemoryStatusLine({ status }: { status: MemoryStatus | null }) {
  return <span>{status ? LABEL[status.state] ?? "Nieznany stan pamięci" : "Sprawdzanie pamięci…"}</span>;
}
export default function Memory() {
  const auth = useGithubSession();
  const { status, error, refresh } = useMemoryStatus();
  const [diagnostic, setDiagnostic] = useState<Record<string, unknown> | null>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  async function runDiagnostic() {
    if (diagnosticBusy) return;
    setDiagnosticBusy(true); setDiagnostic(null); setDiagnosticError("");
    try {
      const result = await requestJson<Record<string, unknown>>("/memory/diagnostic", { method: "POST", body: "{}" });
      if (result.status !== "VERIFIED" || result.assurance !== "LIVE_MEMORY_IO_INTEGRITY") throw Error("NIEZWERYFIKOWANE");
      setDiagnostic(result);
    } catch { setDiagnosticError("Nie udało się potwierdzić cyklu LIVE. Nie wystawiono VERIFIED."); }
    finally { setDiagnosticBusy(false); }
  }
  return <section className="mx-auto max-w-[900px] space-y-4 px-4 py-6 md:px-8">
    <h1 className="text-2xl">Pamięć NeurOSA</h1>
    <GithubLogin auth={auth} />
    <p role="status"><MemoryStatusLine status={status} /></p>
    <p className="text-sm text-dim">{error || status?.message}</p>
    {status?.checked_at && <p className="text-xs text-dim">Sprawdzono: {new Date(status.checked_at).toLocaleString("pl-PL")}</p>}
    <p className="text-sm">W czacie możesz zapisać własną wiadomość. Odpowiedzi korzystające z pamięci zawierają dowód i źródła odczytywane z NeurOSA.</p>
    <p className="text-sm text-dim">Dostępność API nie potwierdza zachowania pamięci po restarcie. Ten test LIVE pozostaje niepotwierdzony.</p>
    <button className="rounded border border-line px-3 py-2 text-sm" onClick={() => void refresh()}>Sprawdź ponownie</button>
    {auth.status?.mode === "preview-operator" && status?.state === "AVAILABLE" && <div className="space-y-2 rounded border border-line p-3">
      <p className="text-sm">Test LIVE: jedna syntetyczna notatka w kanonicznej NeurOSA; zapis → ponowienie → odczyt → recall z nowej sesji. Bez płatnego modelu i restartu.</p>
      <button disabled={diagnosticBusy} className="rounded border border-line px-3 py-2 text-sm disabled:opacity-50" onClick={() => void runDiagnostic()}>{diagnosticBusy ? "Test trwa…" : "Uruchom test integralności NeurOSA"}</button>
      {diagnosticError && <p role="alert" className="text-sm text-dim">{diagnosticError}</p>}
      {diagnostic && <div role="status" className="text-xs break-all">
        <p>Memory LIVE: {String(diagnostic.status)} ({String(diagnostic.assurance)})</p>
        <p>Dokument: {String(diagnostic.document_id)}</p>
        <p>Receipt: {String(diagnostic.receipt_sha256)}</p>
        <p>Context SHA: {String(diagnostic.context_sha256)}</p>
        <p>Trwałość po restarcie: NIEZWERYFIKOWANA. Zewnętrzna atestacja: NIEZWERYFIKOWANA.</p>
      </div>}
    </div>}
  </section>;
}

export interface MemoryPointer { document_id: string; receipt_sha256: string }
async function readVerifiedMemory(pointer: MemoryPointer) {
  const value = await requestJson<{ receipt: Record<string, unknown>; event: Record<string, unknown> }>(`/memory/receipts/${encodeURIComponent(pointer.document_id)}`);
  const { receipt_sha256, ...receipt } = value.receipt;
  const { event_sha256, ...event } = value.event;
  if (receipt_sha256 !== pointer.receipt_sha256 || receipt.document_id !== pointer.document_id ||
      receipt_sha256 !== await sha256(canon(receipt)) || event_sha256 !== await sha256(canon(event)) ||
      receipt.event_sha256 !== event_sha256 || receipt.content_sha256 !== await sha256(canon(value.event)) ||
      canon(receipt.scope) !== canon(event.scope)) throw Error("Niezgodny dowód");
  return { receipt, event };
}
export function MemoryStatementEvidence({ pointer, statement }: { pointer: MemoryPointer; statement: string }) {
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true); setDetail("");
    try {
      const { receipt, event } = await readVerifiedMemory(pointer);
      if (event.kind !== "AUTHENTICATED_USER_STATEMENT" || (event.data as Record<string, unknown>).text !== statement.trim()) throw Error("Niezgodna wiadomość");
      setDetail("Potwierdzono zapis tej wiadomości. Brain: " + receipt.brain_id + "\nDokument: " + pointer.document_id + "\nDowód: " + pointer.receipt_sha256);
    } catch { setDetail("Nie udało się ponownie zweryfikować zapisu wiadomości w NeurOSA."); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 text-xs"><button className="underline" disabled={busy} onClick={() => void verify()}>{busy ? "Weryfikowanie…" : "Sprawdź zapis wiadomości w NeurOSA"}</button>{detail && <p role="status" className="mt-2 whitespace-pre-wrap break-all">{detail}</p>}</div>;
}
export function MemoryEvidence({ pointer, answer }: { pointer: MemoryPointer; answer: string }) {
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true); setDetail("");
    try {
      const { receipt, event } = await readVerifiedMemory(pointer);
      const data = event.data as Record<string, unknown>;
      const memory = data.memory as Record<string, unknown>;
      const { context_sha256, ...context } = memory;
      const response = data.response as { text: string };
      if (event.kind !== "CHAT_PROVENANCE" ||
          canon(memory.scope) !== canon(event.scope) || memory.brain_id !== receipt.brain_id ||
          context_sha256 !== await sha256(canon(context)) || response.text !== answer || data.response_sha256 !== await sha256(canon(answer)))
        throw Error("Niezgodny dowód");
      setDetail("Integralność dowodu potwierdzona. Źródło: " + memory.brain_id +
        "\nŹródła dokumentów: " + JSON.stringify(memory.references, null, 2) +
        "\nLedger: " + memory.ledger_head + "\nDowód: " + pointer.receipt_sha256 +
        "\nPotwierdzenie integralności nie oznacza prawdziwości odpowiedzi modelu.");
    } catch { setDetail("Nie udało się odzyskać i zweryfikować dowodu. Sprawdź dostęp do pamięci; odpowiedź pozostaje niezweryfikowana."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 border-t border-white/10 pt-2 text-xs">
    <button className="underline" disabled={busy} onClick={() => void verify()}>{busy ? "Weryfikowanie…" : "Sprawdź źródła i dowód w NeurOSA"}</button>
    {detail && <p role="status" className="mt-2 whitespace-pre-wrap break-all text-dim">{detail}</p>}
  </div>;
}
