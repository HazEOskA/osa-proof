import { useEffect, useMemo, useState } from "react";
import { Section, Status, Kv, Unknown } from "../ui/primitives";
import RunPicker from "../ui/RunPicker";
import { useOsa } from "../ctx";
import { useRun } from "../lib/hooks";
import { tok } from "../lib/tok";
import type { Run } from "../data/types";

const tone = (t: string) => t.includes("FAILED") ? tok("bad") : t === "VERIFICATION_PASSED" || t === "RUN_VERIFIED" ? tok("ok") : t.startsWith("AGENT") ? tok("violet") : t.startsWith("EVIDENCE") ? tok("info") : tok("cyan");
const txt = (t: string) => t.includes("FAILED") ? tok("bad") : t === "VERIFICATION_PASSED" || t === "RUN_VERIFIED" ? tok("ok") : tok("fg");

function stateAt(run: Run, step: number) {
  const evs = run.events.filter((e) => e.sequence <= step);
  const agents: Record<string, string> = {};
  for (const a of new Set(run.events.map((e) => e.agent_id).filter(Boolean) as string[])) agents[a] = "IDLE";
  let evidence = 0, verdict = "PENDING";
  for (const e of evs) {
    if (e.agent_id) { if (e.type === "AGENT_STARTED") agents[e.agent_id] = "EXECUTING"; if (e.type === "AGENT_COMPLETED") agents[e.agent_id] = "COMPLETE"; if (e.type === "AGENT_FAILED") agents[e.agent_id] = "FAILED"; }
    if (e.type === "EVIDENCE_RECORDED") evidence++;
    if (e.type === "RUN_VERIFIED") verdict = "VERIFIED"; if (e.type === "RUN_FAILED") verdict = "FAILED"; if (e.type === "RUN_INCOMPLETE") verdict = "INCOMPLETE";
  }
  return { agents, evidence, verdict, last: evs[evs.length - 1] };
}
const aTone = (s: string) => s === "EXECUTING" ? "text-fg" : s === "COMPLETE" ? "text-cyan" : s === "FAILED" ? "text-bad" : "text-dim";

export default function Replay() {
  const { data, go } = useOsa();
  const run = useRun();
  const [step, setStep] = useState(0);
  const [play, setPlay] = useState(false);
  const [cmp, setCmp] = useState(false);
  const n = run.events.length;
  useEffect(() => { setStep(0); setPlay(false); }, [run.run_id]);
  useEffect(() => {
    if (!play) return;
    if (step >= n) { setPlay(false); return; }
    const t = setTimeout(() => setStep((s) => s + 1), 650); return () => clearTimeout(t);
  }, [play, step, n]);
  const st = useMemo(() => stateAt(run, step), [run, step]);
  const other = data.runs.find((r) => r.run_id !== run.run_id);
  const diverge = other ? run.events.findIndex((e, i) => e.type !== other.events[i]?.type) + 1 : 0;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 py-6 md:px-8">
      <RunPicker />
      <section className="glass rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button onClick={() => { if (step >= n) setStep(0); setPlay((p) => !p); }} className="focus-ring tap mono rounded-md border border-cyan/50 bg-cyan/10 px-4 text-[12px] text-cyan">{play ? "PAUSE" : step >= n ? "REPLAY" : "REPLAY ▸"}</button>
          <button onClick={() => { setStep(0); setPlay(false); }} className="focus-ring tap mono rounded-md border border-line px-3 text-[12px] text-dim hover:text-fg">NOW ⟲ 0</button>
          <button onClick={() => setCmp((c) => !c)} aria-pressed={cmp} className={`focus-ring tap mono rounded-md border px-3 text-[12px] ${cmp ? "border-cyan/50 text-cyan" : "border-line text-dim hover:text-fg"}`}>COMPARE</button>
          <button disabled title="osa-proof has no fork endpoint" className="tap mono cursor-not-allowed rounded-md border border-line/40 px-3 text-[12px] text-dim/50">FORK</button>
          <span className="mono ml-auto text-[11px] text-dim">step {step} / {n}</span>
        </div>
        <input type="range" min={0} max={n} value={step} onChange={(e) => { setPlay(false); setStep(Number(e.target.value)); }} aria-label="Replay position" className="tap h-11 w-full" style={{ accentColor: tok("brand") }} />
        <div className="relative mt-1 h-6" aria-hidden>{run.events.map((e) => <span key={e.event_id} className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full" style={{ left: `${(e.sequence / n) * 100}%`, background: e.sequence <= step ? tone(e.type) : tok("line2") }} />)}</div>
        <p className="mono text-[10.5px] text-dim">position = event sequence. Events carry no timestamps, so this replays order, not duration. State is derived only from recorded events.</p>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <Section title="INSPECT STATE"><Kv k="last event">{st.last ? `#${st.last.sequence} ${st.last.type}` : "— (before RUN_CREATED)"}</Kv><Kv k="evidence recorded">{st.evidence}</Kv><Kv k="verdict"><Status v={st.verdict === "PENDING" ? "UNKNOWN" : st.verdict} label={st.verdict} /></Kv><Kv k="memory changes"><Unknown /></Kv></Section>
          <Section title="AGENTS">{Object.entries(st.agents).map(([a, s]) => <Kv key={a} k={a}><span className={aTone(s)}>{s}</span></Kv>)}</Section>
        </div>
        <div>
          <Section title="EVENTS UP TO NOW">
            <ol className="max-h-[320px] overflow-y-auto">{run.events.map((e) => (
              <li key={e.event_id} className={`mono flex gap-3 py-1 text-[12px] ${e.sequence <= step ? "" : "opacity-25"}`}><span className="w-6 text-dim">#{e.sequence}</span><span style={{ color: txt(e.type) }}>{e.type}</span>{e.agent_id && <span className="text-dim">{e.agent_id}</span>}</li>))}</ol>
          </Section>
        </div>
      </div>

      {cmp && (
        <section aria-label="Compare runs">
          <div className="label mb-2">COMPARE</div>
          {!other ? <Unknown why="only one run captured" /> : (
            <div className="grid gap-4 md:grid-cols-2">
              {[run, other].map((r) => (
                <div key={r.run_id} className="rounded-lg border border-line"><div className="flex items-center justify-between border-b border-line bg-panel px-3 py-2"><span className="mono text-[12px]">{r.proof.mission_id}</span><Status v={r.verdict} /></div>
                  <ol>{r.events.map((e, i) => (<li key={e.event_id} className={`mono flex gap-3 px-3 py-1 text-[11.5px] ${i + 1 >= diverge && diverge > 0 && e.type !== (r === run ? other : run).events[i]?.type ? "bg-bad/10" : ""}`}><span className="w-6 text-dim">#{e.sequence}</span><span style={{ color: txt(e.type) }}>{e.type}</span></li>))}</ol></div>))}
            </div>
          )}
          {other && diverge > 0 && <p className="mono mt-2 text-[11px] text-dim">first divergence at step #{diverge}: {run.events[diverge - 1]?.type ?? "—"} vs {other.events[diverge - 1]?.type ?? "—"}</p>}
          <button onClick={() => go("proofs")} className="focus-ring tap mono mt-2 text-[12px] text-cyan">Inspect proofs →</button>
        </section>
      )}
    </div>
  );
}
