import { useMemo, useState } from "react";
import { Kv, Section, Status, Unknown, short } from "../ui/primitives";
import RunPicker from "../ui/RunPicker";
import { useOsa } from "../ctx";
import { useNarrow, useRun } from "../lib/hooks";
import { tok } from "../lib/tok";

interface Step { id: string; kind: string; label: string; sub: string; col: number; row: number; state?: string }

export default function Missions() {
  const { data, go, runMission, runningMission, actionError, setRunId } = useOsa();
  const run = useRun();
  const narrow = useNarrow();
  const mission = data.missions.find((m) => m.mission_id === run.proof.mission_id);
  const [sel, setSel] = useState<string>("proof");
  const [runNote, setRunNote] = useState("");

  const { steps, edges } = useMemo(() => {
    const order: string[] = [];
    for (const e of run.events) if (e.type === "AGENT_STARTED" && e.agent_id && !order.includes(e.agent_id)) order.push(e.agent_id);
    const st: Step[] = [{ id: "input", kind: "INPUT", label: "mission input", sub: JSON.stringify(mission?.input ?? "unknown"), col: 0, row: 0 }];
    const ed: [string, string][] = [];
    let prev = "input";
    order.forEach((a, i) => {
      const ag = data.team.agents.find((x) => x.agent_id === a);
      st.push({ id: `a:${a}`, kind: "AGENT", label: a, sub: ag?.role ?? "", col: i + 1, row: 0 }); ed.push([prev, `a:${a}`]); prev = `a:${a}`;
      run.evidence.filter((e) => e.agent_id === a).forEach((e, j) => { st.push({ id: `e:${e.evidence_id}`, kind: "EVIDENCE", label: e.kind, sub: String(e.data.status ?? ""), col: i + 1, row: 1 + j }); ed.push([`a:${a}`, `e:${e.evidence_id}`]); });
    });
    const vc = order.length + 1;
    st.push({ id: "val", kind: "VALIDATION", label: "requirements", sub: `${run.proof.requirement_verdicts.length} requirements`, col: vc, row: 0, state: run.verdict });
    ed.push([prev, "val"]); run.evidence.forEach((e) => ed.push([`e:${e.evidence_id}`, "val"]));
    st.push({ id: "proof", kind: "PROOF", label: "receipt", sub: short(run.proof.proof_id, 10), col: vc + 1, row: 0, state: run.verdict }); ed.push(["val", "proof"]);
    return { steps: st, edges: ed };
  }, [run, data, mission]);

  const cols = Math.max(...steps.map((s) => s.col)) + 1, rows = Math.max(...steps.map((s) => s.row)) + 1;
  const CW = narrow ? 120 : 150, RH = narrow ? 96 : 92, NW = 116, NH = 50;
  const pos = (s: Step) => narrow ? { x: 20 + s.row * CW + NW / 2, y: 20 + s.col * RH + NH / 2 } : { x: 20 + s.col * CW + NW / 2, y: 20 + s.row * RH + NH / 2 };
  const W = narrow ? 40 + (rows - 1) * CW + NW : 40 + (cols - 1) * CW + NW, H = narrow ? 40 + (cols - 1) * RH + NH : 40 + (rows - 1) * RH + NH;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const col = (s: Step) => s.kind === "AGENT" ? tok("violet") : s.kind === "EVIDENCE" ? tok("info") : s.state === "VERIFIED" ? tok("ok") : s.state === "FAILED" ? tok("bad") : tok("cyan");
  const cur = byId.get(sel) ?? byId.get("proof")!;

  const detail = () => {
    if (cur.kind === "INPUT") return <><Kv k="mission input">{JSON.stringify(mission?.input ?? "unknown")}</Kv><Kv k="entry agent">{mission?.entry_agent_id ?? "unknown"}</Kv></>;
    if (cur.kind === "AGENT") { const id = cur.label; return <>{run.events.filter((e) => e.agent_id === id).map((e) => <Kv key={e.event_id} k={`#${e.sequence}`}>{e.type}</Kv>)}<Kv k="executor">{data.team.agents.find((a) => a.agent_id === id)?.executor_ref}</Kv><Kv k="model">{data.team.agents.find((a) => a.agent_id === id)?.model_ref ?? <Unknown why="model_ref not set on agent" />}</Kv></>; }
    if (cur.kind === "EVIDENCE") { const ev = run.evidence.find((e) => `e:${e.evidence_id}` === cur.id)!; return <><Kv k="kind">{ev.kind}</Kv><Kv k="provenance">{ev.provenance}</Kv><Kv k="evidence_sha256">{ev.evidence_sha256}</Kv><Kv k="operation">{ev.producer.operation_id}</Kv><pre className="mono mt-2 max-h-40 overflow-auto rounded bg-panel p-2 text-[11px] text-dim">{JSON.stringify(ev.data, null, 1)}</pre></>; }
    if (cur.kind === "VALIDATION") return <>{run.proof.requirement_verdicts.map((rv) => <div key={rv.requirement_id} className="py-1.5"><div className="flex items-center justify-between"><span className="mono text-[12px]">{rv.requirement_id}</span><Status v={rv.verdict} /></div><div className="text-[12px] text-dim">{rv.reason}</div></div>)}</>;
    return <><Kv k="proof_id">{run.proof.proof_id}</Kv><Kv k="verdict"><Status v={run.verdict} /></Kv><Kv k="created_at">{run.proof.created_at}</Kv><button onClick={() => go("proofs", { runId: run.run_id })} className="focus-ring tap mono mt-2 rounded-md border border-cyan/40 px-3 text-[12px] text-cyan">Verify this proof →</button></>;
  };

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-8">
      <RunPicker />
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-3">
        <button
          type="button"
          disabled={!mission || runningMission === mission?.mission_id}
          onClick={async () => {
            if (!mission) return;
            setRunNote("");
            try {
              const fresh = await runMission(mission.mission_id);
              setRunId(fresh.run_id);
              setRunNote(`LIVE ${fresh.verdict} · ${fresh.execution_id}`);
            } catch (error) {
              setRunNote(`ERROR · ${error instanceof Error ? error.message : String(error)}`);
            }
          }}
          className="focus-ring tap rounded-md border border-cyan/50 bg-ink px-3 text-[12px] font-semibold uppercase tracking-[.1em] text-cyan disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runningMission === mission?.mission_id ? "Executing…" : "Run mission live"}
        </button>
        <span className="mono min-w-0 flex-1 break-all text-[10.5px] text-dim">{runNote || actionError || "POST Team Graph → Mission → Runtime → Evidence → Proof"}</span>
      </div>
      <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
        <div><div className="label">MISSION</div><div className="mono text-[13px]">{run.proof.mission_id}</div></div>
        <div><div className="label">STATUS</div><Status v={run.verdict} /></div>
        <div className="md:col-span-2"><div className="label">OBJECTIVE</div><div className="text-[16px]">{mission?.objective ?? <Unknown />}</div></div>
        <div><div className="label">AGENTS</div><span className="mono text-[12px]">{data.team.agents.map((a) => a.agent_id).join(" → ")}</span></div>
        <div><div className="label">RUNTIME</div><span className="mono break-all text-[12px]">{run.execution_id}</span></div>
        <div><div className="label">COST</div><Unknown /></div>
        <div><div className="label">POLICY</div><Unknown why="no policy_ref on agents" /></div>
      </div>

      <section aria-label="Mission execution graph">
        <div className="mb-2 flex items-center justify-between"><span className="label">MISSION EXECUTION GRAPH</span><span className="mono text-[10.5px] text-dim">PLAN / MODEL / TOOL / ACTION nodes: not recorded by osa-proof</span></div>
        <div className="glass relative rounded-xl p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ maxHeight: narrow ? 560 : 340 }} role="img" aria-label="Mission execution graph">
            {edges.map(([a, b], i) => { const A = pos(byId.get(a)!), B = pos(byId.get(b)!); return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={tok("line2")} strokeWidth="1.2" className={b === "proof" || b === "val" ? "" : "flow-edge"} opacity="0.75" />; })}
            {steps.map((s) => { const p = pos(s); const c = col(s); const on = s.id === sel; return (
              <g key={s.id} transform={`translate(${p.x - NW / 2} ${p.y - NH / 2})`} onClick={() => setSel(s.id)} style={{ cursor: "pointer" }} role="button" tabIndex={0} aria-label={`${s.kind} ${s.label}`} onKeyDown={(e) => e.key === "Enter" && setSel(s.id)}>
                <rect width={NW} height={NH} rx="8" fill={tok("panel")} stroke={on ? tok("fg") : c} strokeWidth={on ? 2 : 1.2} />
                <text x="10" y="17" fontSize="9" fill={tok("dim")} style={{ fontFamily: "Exo 2", letterSpacing: ".18em" }}>{s.kind}</text>
                <text x="10" y="32" fontSize="12" fill={tok("fg")} style={{ fontFamily: "JetBrains Mono" }}>{s.label.length > 13 ? `${s.label.slice(0, 12)}…` : s.label}</text>
                <text x="10" y="44" fontSize="9" fill={tok("dim")} style={{ fontFamily: "JetBrains Mono" }}>{s.sub.length > 17 ? `${s.sub.slice(0, 16)}…` : s.sub}</text>
              </g>); })}
          </svg>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section><Section title={`${cur.kind} · ${cur.label}`}>{detail()}</Section></section>
        <section>
          <Section title="ACCEPTANCE REQUIREMENTS">
            {mission?.requirements.map((r) => { const v = run.proof.requirement_verdicts.find((x) => x.requirement_id === r.requirement_id); return (
              <div key={r.requirement_id} className="py-1.5"><div className="flex items-center justify-between"><span className="mono text-[12px]">{r.requirement_id}</span>{v ? <Status v={v.verdict} /> : <Unknown />}</div>
                <div className="mono text-[11px] text-dim">{r.evidence_kind}.{r.field} == {JSON.stringify(r.expected)}{r.agent_id ? ` @ ${r.agent_id}` : ""}</div></div>); })}
          </Section>
        </section>
      </div>
    </div>
  );
}
