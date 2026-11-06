import type { LiveTrace } from "../lib/live-execution";
import { downloadLiveEvidence, downloadLiveTrace } from "../lib/live-execution";

const labels:Record<string,string>={
  accepted:"Przyjęcie i zakres",context_started:"Kontekst i pamięć — rozpoczęto",
  context_completed:"Kontekst i pamięć — zakończono",cognitive_planning_started:"Cognitive Layer — planowanie",cognitive_plan_accepted:"Cognitive Layer — plan przyjęty",model_started:"NVIDIA — oczekiwanie na model",
  model_completed:"NVIDIA — odpowiedź modelu",apr_verification_checked:"APR — weryfikacja wyniku",cognitive_execution_completed:"Brain i APR — zakończono",evidence_started:"Dowody — rozpoczęto",
  evidence_completed:"Dowody — zakończono",completed:"Wykonanie zakończono",
  failed:"Błąd wykonania",cancel_requested:"Wysłano sygnał przerwania",
  cancel_unconfirmed:"Anulowanie niepotwierdzone",request_sent:"Wysłano żądanie",
  tool_completed:"Wynik narzędzia",mission_update:"Mission Kernel — aktualizacja"
};
const statusLabel:Record<string,string>={
  RUNNING:"TRWA",COMPLETED:"ZAKOŃCZONO",FAILED:"BŁĄD",
  CANCEL_REQUESTED:"PRZERWANIE ZGŁOSZONE",CANCEL_UNCONFIRMED:"ANULOWANIE NIEPOTWIERDZONE"
};
export default function UnifiedLiveProgress({
  trace,active,onCancel
}:{
  trace:LiveTrace;active:boolean;onCancel?:()=>void;
}) {
  return <section data-testid="osa-unified-live-trace" aria-label="Przebieg wykonania OSA na żywo"
    className="mt-3 max-h-80 overflow-auto rounded-xl border border-cyan/30 bg-[#080d17] p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>OSA · PRZEBIEG WYKONANIA · {trace.mode==="conversation"?"ROZMOWA":trace.mode==="artifact"?"ARTEFAKT":"NARZĘDZIE"}</strong>
      <span role="status" className={trace.state==="FAILED"||trace.state==="CANCEL_UNCONFIRMED"?"text-warn":"text-cyan"}>
        {statusLabel[trace.state]||trace.state}
      </span>
    </div>
    <div className="mt-2 break-all font-mono text-[10px] text-dim">{trace.execution_id}</div>
    <ol className="mt-3 space-y-1" data-testid="osa-live-events">
      {trace.events.map((e,i)=><li key={e.at+"-"+i} className="flex flex-col rounded border border-line px-2 py-2">
        <span className="flex justify-between gap-2"><strong>{labels[e.phase]||e.phase}</strong><time className="shrink-0 text-dim">{e.at.slice(11,19)}</time></span>
        <span className={e.state==="FAILED"||e.state==="CANCEL_UNCONFIRMED"?"text-warn":"text-dim"}>
          {e.detail||e.source||e.state}{e.code?" · "+e.code:""}
        </span>
      </li>)}
      {trace.events.length===0&&<li className="text-dim">Oczekiwanie na faktyczne zdarzenie serwera…</li>}
    </ol>
    {trace.mode==="artifact"&&trace.tasks?.length!==undefined&&<details className="mt-2">
      <summary>Etapy Mission Kernel ({trace.tasks.length})</summary>
      <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {trace.tasks.map(t=><li key={t.agent_id} className="flex justify-between gap-2 rounded border border-line px-2 py-1">
          <span>{t.agent_id}</span><span>{t.state}</span>
        </li>)}
      </ul>
    </details>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={()=>downloadLiveTrace(trace)} className="rounded border border-cyan/40 px-2 py-2 text-cyan">Pobierz trace</button>
      <button type="button" onClick={()=>downloadLiveEvidence(trace)} className="rounded border border-line px-2 py-2">Pobierz evidence</button>
      {active&&onCancel&&<button type="button" data-testid="osa-live-cancel" onClick={onCancel}
        className="rounded border border-warn/60 px-2 py-2 text-warn">Przerwij wykonanie</button>}
    </div>
    <p className="mt-2 text-[10px] text-dim">
      Wyłącznie obserwowane zdarzenia. Zwykła rozmowa nie tworzy artefaktu ani ProofReceipt.
      Przerwanie po stronie dostawcy może pozostać niepotwierdzone; trace nie jest trwałym logiem serwera.
    </p>
  </section>;
}
