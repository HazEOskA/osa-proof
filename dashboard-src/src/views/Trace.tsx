import { useState } from "react";
import { Kv, Section, Status, Unknown } from "../ui/primitives";
import RunPicker from "../ui/RunPicker";
import { useOsa } from "../ctx";
import { useRun } from "../lib/hooks";
import { tok } from "../lib/tok";
import type { RuntimeEvent } from "../data/types";

const tone = (t: string) => t.includes("FAILED") ? tok("bad") : t === "VERIFICATION_PASSED" || t === "RUN_VERIFIED" ? tok("ok") : t.startsWith("AGENT") ? tok("violet") : t.startsWith("EVIDENCE") ? tok("info") : tok("cyan");
const txt = (t: string) => t.includes("FAILED") ? tok("bad") : t === "VERIFICATION_PASSED" || t === "RUN_VERIFIED" ? tok("ok") : tok("fg");
const TABS = ["TREE", "TIMELINE", "PROOF VIEW"] as const;
const OFF = ["CAUSAL GRAPH", "AGENT VIEW", "TOOL VIEW", "MODEL VIEW"];

export default function Trace() {
  const { data, go } = useOsa();
  const run = useRun();
  const [tab, setTab] = useState<(typeof TABS)[number]>("TREE");
  const [selSeq, setSelSeq] = useState<number>(4);
  const ev = run.events.find((e) => e.sequence === selSeq) ?? run.events[0];
  const agents = [...new Set(run.events.map((e) => e.agent_id).filter(Boolean))] as string[];
  const evidence = ev.type === "EVIDENCE_RECORDED" ? run.evidence.find((x) => x.evidence_id === ev.payload.evidence_id) : undefined;
  const agent = data.team.agents.find((a) => a.agent_id === ev.agent_id);

  const row = (e: RuntimeEvent, indent = false) => (
    <button key={e.event_id} onClick={() => setSelSeq(e.sequence)} className={`focus-ring tap flex w-full items-center gap-3 border-l-2 px-3 text-left ${indent ? "ml-4 w-[calc(100%-1rem)]" : ""} ${e.sequence === ev.sequence ? "bg-raise sel-mark" : "hover:bg-panel"}`} style={{ borderColor: tone(e.type) }}>
      <span className="mono w-6 text-[10px] text-dim">#{e.sequence}</span><span className="mono flex-1 truncate text-[12px]" style={{ color: txt(e.type) }}>{e.type}</span>
    </button>
  );

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-8">
      <RunPicker />
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="Trace views">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`focus-ring tap mono -mb-px border-b-2 px-3 text-[11px] tracking-wider ${tab === t ? "border-cyan text-cyan" : "border-transparent text-dim hover:text-fg"}`}>{t}</button>)}
        <button onClick={() => go("world")} className="focus-ring tap mono px-3 text-[11px] tracking-wider text-dim hover:text-fg" title="Opens Knowledge World with the causal path">CAUSAL GRAPH ↗</button>
        {OFF.slice(1).map((t) => <span key={t} title="not reported by osa-proof (no per-agent/tool/model spans yet)" className="mono grid tap place-items-center px-3 text-[11px] tracking-wider text-dim/50">{t}</span>)}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {tab === "TREE" && (
            <div className="rounded-lg border border-line">
              <div className="mono flex items-center gap-3 border-b border-line bg-panel px-3 py-2 text-[11px]"><span className="text-dim">RUN</span><span className="truncate">{run.run_id}</span><span className="ml-auto"><Status v={run.verdict} /></span></div>
              {run.events.filter((e) => !e.agent_id).slice(0, 2).map((e) => row(e))}
              {agents.map((a) => (<div key={a} className="border-t border-line"><div className="mono flex items-center gap-2 bg-panel/60 px-3 py-1.5 text-[11px] text-fg">◆ {a}<span className="text-dim">· {data.team.agents.find((x) => x.agent_id === a)?.executor_ref}</span></div>{run.events.filter((e) => e.agent_id === a).map((e) => row(e, true))}</div>))}
              <div className="border-t border-line">{run.events.filter((e) => !e.agent_id).slice(2).map((e) => row(e))}</div>
            </div>
          )}
          {tab === "TIMELINE" && (
            <div className="glass overflow-hidden rounded-lg p-4">
              <div className="mono mb-3 text-[10.5px] text-dim">ordered by sequence · events carry no timestamps, so spacing is not duration</div>
              {["runtime", ...agents].map((lane) => (
                <div key={lane} className="flex items-center gap-3 py-2"><span className="mono w-16 shrink-0 truncate text-[10px] text-dim">{lane}</span>
                  <div className="relative h-8 flex-1 border-y border-line">
                    {run.events.filter((e) => (lane === "runtime" ? !e.agent_id : e.agent_id === lane)).map((e) => (
                      <button key={e.event_id} onClick={() => setSelSeq(e.sequence)} title={`#${e.sequence} ${e.type}`} aria-label={`#${e.sequence} ${e.type}`} className="focus-ring absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-ink"
                        style={{ left: `${((e.sequence - 0.5) / run.events.length) * 100}%`, borderColor: tone(e.type), boxShadow: e.sequence === ev.sequence ? `0 0 0 3px ${tok("brand", 0.55)}` : undefined }} />))}
                  </div></div>))}
            </div>
          )}
          {tab === "PROOF VIEW" && (
            <div className="rounded-lg border border-line p-4">
              <div className="mb-2 flex items-center justify-between"><span className="label">PROOF</span><Status v={run.verdict} /></div>
              <Kv k="proof_id">{run.proof.proof_id}</Kv><Kv k="evidence_root">{run.proof.evidence_root}</Kv><Kv k="records">{run.evidence.length} evidence · {run.observations.length} observations</Kv>
              <button onClick={() => go("proofs", { runId: run.run_id })} className="focus-ring tap mono mt-3 rounded-md border border-cyan/40 px-3 text-[12px] text-cyan">Recompute & verify →</button>
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-line bg-ink p-4" aria-label="Step detail">
          <div className="label mb-1">STEP #{ev.sequence}</div><div className="mono mb-2 text-[13px]" style={{ color: txt(ev.type) }}>{ev.type}</div>
          <Section title="Context"><Kv k="Mission">{ev.mission_id}</Kv><Kv k="Agent">{ev.agent_id ?? "runtime"}</Kv><Kv k="Step">{ev.sequence} / {run.events.length}</Kv><Kv k="Execution">{ev.execution_id ?? <Unknown />}</Kv></Section>
          <Section title="Model & cost"><Kv k="Model">{agent?.model_ref ?? <Unknown why="model_ref not set" />}</Kv><Kv k="Tokens"><Unknown /></Kv><Kv k="Latency"><Unknown why="events carry no timestamps" /></Kv><Kv k="Cost"><Unknown /></Kv></Section>
          <Section title="Tool & memory"><Kv k="Tool / executor">{agent?.executor_ref ?? <Unknown />}</Kv><Kv k="Memory used">{agent?.memory_ref ?? <Unknown />}</Kv><Kv k="Policy">{agent?.policy_ref ?? <Unknown />}</Kv></Section>
          <Section title="Evidence & proof">
            <Kv k="Evidence">{evidence ? `${evidence.kind} · ${evidence.evidence_sha256.slice(0, 14)}…` : <Unknown why="this step recorded no evidence" />}</Kv>
            <Kv k="Proof">{run.proof.proof_id.slice(0, 14)}…</Kv>
          </Section>
          <Section title="Payload"><pre className="mono max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-2 text-[11px] text-dim">{JSON.stringify(evidence ? { ...ev.payload, data: evidence.data } : ev.payload, null, 1)}</pre></Section>
        </aside>
      </div>
    </div>
  );
}
