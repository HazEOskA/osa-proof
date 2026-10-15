import { useState } from "react";
import { useOsa } from "../ctx";
import { requestJson } from "../data/data";
import type { TeamGraph, Mission, Run } from "../data/types";

// Existing private Jeverson runtime is reused; no secrets, message content,
// proof receipts or provider calls are forwarded by OSA Proof.
function approvedUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

const traceTargets = [
  "https://osa-proof-gx6alklct-osabarca-1680s-projects.vercel.app/api/layers",
  "https://osa-proof-gx6alklct-osabarca-1680s-projects.vercel.app/api/build/status",
];
const defaultTracePrompt = [
  "OSA-TRACE-001 — wykonaj dokładnie dwa rzeczywiste żądania HTTP GET:",
  ...traceTargets,
  "Pokaż kod HTTP, faktyczne kroki i evidence. Niczego nie zapisuj ani nie wdrażaj.",
].join("\n");
type TraceOutcome = {
  task_status: "EXECUTED" | "BLOCKED";
  execution_id: string;
  run_id: string;
  proof_id: string;
  proof_verdict: string;
  provider: string;
  steps: Array<{step:number;url:string;http_status:number|null;status:string;response_sha256:string|null;response_excerpt:string;error_code?:string}>;
  team: TeamGraph; mission: Mission; run: Run;
};

const liveUrl = approvedUrl(import.meta.env.VITE_OSA_JEVERSON_URL as string | undefined);
const blackPreviewUrl = approvedUrl(import.meta.env.VITE_OSA_JEVERSON_THEME_PREVIEW_URL as string | undefined);

export default function JeversonChat() {
  // Remain operational by default: Vercel Black branch preview has no AI keys.
  const [mode, setMode] = useState<"live" | "black">("live");
  const [frameProblem, setFrameProblem] = useState(false);
  const { inspectExecution, go } = useOsa();
  const [tracePrompt, setTracePrompt] = useState(defaultTracePrompt);
  const [tracePending, setTracePending] = useState(false);
  const [traceError, setTraceError] = useState("");
  const [traceOutcome, setTraceOutcome] = useState<TraceOutcome | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  async function executeTrace() {
    if (tracePending) return;
    setTracePending(true);
    setTraceError("");
    setTraceOutcome(null);
    try {
      const result = await requestJson<TraceOutcome>("/trace-probe", {
        method: "POST", body: JSON.stringify({task_id:"OSA-TRACE-001",prompt:tracePrompt})
      });
      setTraceOutcome(result);
      inspectExecution(result.team,result.mission,result.run);
    } catch(error) {
      setTraceError(error instanceof Error ? error.message : String(error));
    } finally {
      setTracePending(false);
    }
  }

  const canPreview = !!blackPreviewUrl && blackPreviewUrl !== liveUrl;
  const previewActive = mode === "black" && canPreview;
  const activeUrl = previewActive ? blackPreviewUrl : liveUrl;

  const changeMode = (next: "live" | "black") => {
    setFrameProblem(false);
    setMode(next);
  };

  return (
    <section aria-label="Jeverson Chat" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-void">
      <header data-testid="jeverson-toolbar"
        className="flex min-h-[56px] shrink-0 items-center justify-between gap-2 border-b border-line bg-ink px-2 py-2 sm:min-h-[68px] sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[12px] font-semibold tracking-[.06em] text-fg sm:text-[15px]">
            <span className="sm:hidden">JEV / CHAT</span>
            <span className="hidden sm:inline">Jeverson Chat</span>
          </h2>
          <p className="mt-0.5 truncate text-[9px] tracking-wide text-dim sm:text-[11px]">
            {previewActive ? "BLACK · UI ONLY" : "OSA AGENT WORLD · LIVE"}
          </p>
        </div>
        <nav aria-label="Jeverson links" className="flex shrink-0 items-center gap-1 sm:gap-2">
          {canPreview && (
            <div role="group" aria-label="Wersja Jeversona"
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-panel p-0.5">
              <button type="button" aria-pressed={!previewActive} onClick={() => changeMode("live")}
                className={`focus-ring h-8 shrink-0 rounded px-2 text-[11px] sm:h-9 sm:px-3 sm:text-[12px] ${!previewActive ? "bg-raise text-fg" : "text-dim hover:text-fg"}`}>
                LIVE
              </button>
              <button type="button" aria-pressed={previewActive} onClick={() => changeMode("black")}
                className={`focus-ring h-8 shrink-0 rounded px-2 text-[11px] sm:h-9 sm:px-3 sm:text-[12px] ${previewActive ? "bg-raise text-fg" : "text-dim hover:text-fg"}`}>
                BLACK
              </button>
            </div>
          )}
          {activeUrl && <a href={activeUrl} target="_blank" rel="noopener noreferrer"
            aria-label="Otwórz aktualnego Jeversona w pełnym ekranie"
            title="Otwórz aktualną wersję w nowej karcie"
            className="focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-[15px] text-fg hover:bg-raise sm:h-10 sm:w-auto sm:px-3">
            <span aria-hidden="true">↗</span><span className="hidden sm:inline"> Pełny ekran</span>
          </a>}
        </nav>
      </header>
      <div className="shrink-0 border-b border-line bg-ink px-3 py-2 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-fg">OSA Proof · zadanie monitorowane</div>
            <p className="text-[10px] text-dim">OSA-TRACE-001 · dwa dozwolone GET · wykonanie w OSA Runtime, nie w iframe</p>
          </div>
          <button type="button" aria-expanded={traceOpen} onClick={()=>setTraceOpen(v=>!v)}
            className="focus-ring rounded border border-line px-3 py-1.5 text-[11px] text-fg">
            {traceOpen ? "Zwiń" : "Otwórz test"}
          </button>
        </div>
        {traceOpen && <div className="mt-2 space-y-2">
          <label htmlFor="osa-trace-task" className="block text-[11px] text-dim">Prompt dla agenta HTTP (tylko dozwolone endpointy)</label>
          <textarea id="osa-trace-task" aria-label="Monitorowane zadanie OSA-TRACE-001"
            className="w-full resize-y rounded border border-line bg-panel px-3 py-2 font-mono text-[11px] text-fg"
            rows={5} maxLength={5000} value={tracePrompt} onChange={e=>setTracePrompt(e.target.value)}/>
          <button type="button" disabled={tracePending} onClick={()=>void executeTrace()}
            className="focus-ring rounded border border-line bg-raise px-4 py-2 text-[12px] font-semibold text-fg disabled:opacity-40">
            {tracePending ? "Wykonuję GET i zbieram evidence…" : "Wykonaj monitorowane zadanie"}
          </button>
          {traceError && <p role="alert" className="text-[11px] text-bad">BLOCKED · {traceError}</p>}
          {traceOutcome && <div aria-label="OSA Proof Trace Result" className="space-y-1 rounded border border-line bg-panel p-3 text-[11px]">
            <div className="font-semibold text-fg">{traceOutcome.task_status} · APR {traceOutcome.proof_verdict}</div>
            <div className="break-all font-mono text-dim">execution_id: {traceOutcome.execution_id}</div>
            {traceOutcome.steps.map(step=><div key={step.step} className="break-all font-mono text-dim">
              {step.step}. GET {step.url} · HTTP {step.http_status ?? "BRAK"} · {step.status}{step.error_code ? " · "+step.error_code : ""}
            </div>)}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className="focus-ring rounded border border-line px-3 py-2 text-fg"
                onClick={()=>go("trace",{runId:traceOutcome.run_id})}>Tracing →</button>
              <button type="button" className="focus-ring rounded border border-line px-3 py-2 text-fg"
                onClick={()=>go("proofs",{runId:traceOutcome.run_id})}>Proofs →</button>
            </div>
            <p className="text-dim">Proof zawiera rzeczywiste evidence HTTP; nie potwierdza wykonania narzędzi przez model Jeversona.</p>
          </div>}
        </div>}
      </div>
      {!activeUrl ? (
        <div className="grid min-h-0 flex-1 place-items-center p-4">
          <div className="max-w-xl space-y-2 rounded-lg border border-line bg-panel p-5">
            <div className="label">JEVERSON · DISCONNECTED</div>
            <p className="text-[13px]">Nie ustawiono adresu istniejącej aplikacji Jeverson.</p>
          </div>
        </div>
      ) : (
        <>
          {frameProblem && <div role="status" className="shrink-0 border-b border-line px-3 py-1.5 text-[11px] text-dim">
            Nie udało się załadować osadzonej strony. Spróbuj przycisku ↗.
          </div>}
          <iframe key={activeUrl} title="Jeverson Chat" src={activeUrl}
            data-testid="jeverson-iframe"
            className="block min-h-0 min-w-0 w-full flex-1 border-0 bg-void"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            referrerPolicy="no-referrer" onError={() => setFrameProblem(true)} />
        </>
      )}
      <footer className="mono flex h-7 shrink-0 items-center border-t border-line bg-ink px-2 text-[9px] text-dim sm:h-8 sm:px-5 sm:text-[10px]">
        <span className="truncate sm:hidden">{previewActive ? "BLACK UI PREVIEW · MODEL OFF" : "JEV LIVE · E2E PROOF PENDING"}</span>
        <span className="hidden truncate sm:inline">
          {previewActive ? "VERCEL BLACK · UI PREVIEW ONLY · providers not configured" :
            "JEV LIVE · Jeverson receipts ≠ OSA Proof receipts · E2E verification pending"}
        </span>
      </footer>
    </section>
  );
}
