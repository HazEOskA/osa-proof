import NvidiaChat from "../ui/NvidiaChat";
import { useWeb3Data } from "../data/web3";
import { mergeWeb3Graph, type Graph } from "../lib/graph";
import { useMemo, useRef, useState } from "react";
import SolarWorld from "../ui/SolarWorld";
import { NODE_TYPES, causalPath, typeColor, type GNode } from "../lib/graph";
import { Kv, Section, Status, Unknown } from "../ui/primitives";
import { useOsa } from "../ctx";
import { mergeNvidiaGraph, NVIDIA_ROOT } from "../lib/nvidia";
import { tok } from "../lib/tok";

const val = (v?: string) => (v && v.length ? <span className="mono break-all text-[12px]">{v}</span> : <Unknown />);

function Inspector({ n, onClose, onSelect, graph }: { graph: Graph; n: GNode; onClose: () => void; onSelect: (id: string) => void }) {
  const { data } = useOsa();
  const rel = graph.edges.filter((e) => e.from === n.id || e.to === n.id);
  const proofs = graph.nodes.filter((p) => p.type === "PROOF" && n.runId && p.runId === n.runId && p.id !== n.id);
  const events = n.type === "AGENT" ? data.runs.flatMap((r) => r.events.filter((e) => `agent:${e.agent_id}` === n.id)).length : n.runId ? data.runs.find((r) => r.run_id === n.runId)?.events.length : undefined;
  return (
    <div className="flex h-full flex-col bg-ink">
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0"><div className="label" style={{ color: typeColor(n) }}>{n.type}</div><div className="mono mt-1 break-all text-[14px]">{n.label}</div>{n.sub && <div className="mt-0.5 truncate text-[12px] text-dim">{n.sub}</div>}</div>
        <button onClick={onClose} aria-label="Close inspector" className="focus-ring tap grid w-11 place-items-center text-dim hover:text-fg">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        {n.id.startsWith("nvidia:") && <Section title="NVIDIA bridge">
          <p className="text-[12px] text-dim">{n.detail.description}</p>
          <p className="mono py-2 text-[11px]">{n.detail.execution}</p>
          {n.detail.url && <a href={n.detail.url} target="_blank" rel="noopener noreferrer" className="focus-ring block py-2 text-cyan">Otwórz zasób NVIDIA ↗</a>}
          {n.detail.docs && <a href={n.detail.docs} target="_blank" rel="noopener noreferrer" className="focus-ring block py-2 text-cyan">Dokumentacja API ↗</a>}
        </Section>}
        {n.id === "nvidia:models" && <Section title="Rozmowa z NVIDIA"><NvidiaChat /></Section>}
        <Section title="Identity"><Kv k="id">{val(n.detail.identity)}</Kv><Kv k="kind">{val(n.detail.kind)}</Kv></Section>
        <Section title="State"><div className="py-1">{n.detail.state ? (n.state ? <Status v={n.state} /> : <span className="mono text-[12px]">{n.detail.state}</span>) : <Unknown />}</div></Section>
        <Section title={`Relationships · ${rel.length}`}>
          <ul className="space-y-0.5">{rel.map((e) => { const other = graph.byId.get(e.from === n.id ? e.to : e.from)!; return (
            <li key={e.id}><button onClick={() => onSelect(other.id)} className="focus-ring flex w-full items-center justify-between gap-3 rounded px-1.5 py-1 text-left hover:bg-raise"><span className="mono truncate text-[12px]">{e.from === n.id ? "→" : "←"} {other.label}</span><span className="mono shrink-0 text-[10px] text-dim">{e.kind}</span></button></li>); })}</ul>
        </Section>
        <Section title="Inputs">{val(n.detail.inputs)}</Section>
        <Section title="Outputs">{val(n.detail.outputs)}</Section>
        <Section title="Events">{events === undefined ? <Unknown /> : <span className="mono text-[12px]">{events} runtime events{n.type === "AGENT" ? " (all runs)" : ""}</span>}</Section>
        <Section title="Proofs">{n.type === "PROOF" ? <span className="mono text-[12px]">this node</span> : proofs.length ? proofs.map((p) => <button key={p.id} onClick={() => onSelect(p.id)} className="focus-ring mono block py-0.5 text-left text-[12px] text-cyan">{p.label} · {p.sub}</button>) : <Unknown why="no proof linked to this entity" />}</Section>
        <Section title="Dependencies">{val(n.detail.dependencies)}</Section>
        <Section title="Owner">{val(n.detail.owner)}</Section>
        <Section title="Version">{val(n.detail.version)}</Section>
        <Section title="Last change">{val(n.detail["last change"])}</Section>
      </div>
    </div>
  );
}

export default function World() {
  const { graph: baseGraph, data, focus, go } = useOsa();
  const web3 = useWeb3Data();
  const [nvidiaOpen, setNvidiaOpen] = useState(false);
  const graph = useMemo(() => mergeNvidiaGraph(mergeWeb3Graph(baseGraph,web3.mission), nvidiaOpen),[baseGraph,web3.mission,nvidiaOpen]);
  const [sel, setSel] = useState<string | null>(focus);
  const select = (id: string | null) => { if (id === NVIDIA_ROOT) setNvidiaOpen((open) => !open); setSel(id); };
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [causal, setCausal] = useState<string>("");
  const box = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const n of graph.nodes) c[n.type] = (c[n.type] ?? 0) + 1; return c; }, [graph]);
  const hl = useMemo(() => (causal ? causalPath(graph, causal) : null), [causal, graph]);
  const node = sel ? graph.byId.get(sel) : null;
  const toggle = (t: string) => setHidden((h) => { const s = new Set(h); s.has(t) ? s.delete(t) : s.add(t); return s; });
  return (
    <div ref={box} className="flex h-full min-h-[560px] flex-col bg-void">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink px-3 py-2 md:px-5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search graph…" aria-label="Search graph" className="focus-ring tap mono w-full rounded-md border border-line bg-panel px-3 text-[12px] placeholder:text-dim sm:w-56" />
        <select aria-label="Show causal path" value={causal} onChange={(e) => { setCausal(e.target.value); setSel(null); }} className="focus-ring tap mono rounded-md border border-line bg-panel px-2 text-[12px] text-dim">
          <option value="">Causal path: off</option>
          {data.runs.map((r) => <option key={r.run_id} value={r.proof.mission_id}>Show causal path · {r.proof.mission_id} ({r.verdict})</option>)}
        </select>
        <button onClick={() => document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.()} className="focus-ring tap mono rounded-md border border-line px-3 text-[12px] text-dim hover:text-fg">Fullscreen</button>
        <button onClick={() => go("replay")} className="focus-ring tap mono rounded-md border border-line px-3 text-[12px] text-dim hover:text-fg">Time travel → Replay</button>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-line bg-ink px-3 py-2 md:px-5" role="group" aria-label="Filter node types">
        {NODE_TYPES.map((t) => { const c = counts[t] ?? 0; const off = hidden.has(t); return (
          <button key={t} disabled={!c} onClick={() => toggle(t)} aria-pressed={!off && c > 0} title={c ? undefined : "no instances in captured data"} className={`focus-ring mono h-7 items-center gap-1.5 rounded border px-2 text-[10px] tracking-wider ${c ? "flex" : "hidden sm:flex"} ${!c ? "cursor-default border-line/40 text-dim/50" : off ? "border-line text-dim line-through" : "border-line2 text-fg"}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: c ? typeColor({ type: t }) : tok("line") }} />{t}<span className="text-dim">{c}</span></button>); })}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <SolarWorld graph={graph} selectedId={sel} onSelect={select} highlight={hl} hiddenTypes={hidden} query={q} focusId={focus} className="absolute inset-0" />
          {causal && hl && <div className="mono glass absolute left-3 top-3 max-w-[70%] rounded-md px-3 py-2 text-[11px] text-dim">CAUSAL PATH · {hl.nodes.size} entities · only steps present in the run are shown (no model/tool/deploy nodes recorded)</div>}
          <div className="mono pointer-events-none absolute bottom-3 left-3 right-16 text-[10px] text-dim">sun = Team Graph · orbit = node type · planet = entity · drag to orbit · scroll / pinch to zoom · click a planet</div>
        </div>
        {node && (
          <>
            <div className="fixed inset-x-0 bottom-0 z-30 h-[62dvh] slide-in border-t border-line lg:hidden"><Inspector graph={graph} n={node} onClose={() => setSel(null)} onSelect={select} /></div>
            <div className="slide-in hidden w-[340px] shrink-0 border-l border-line lg:block"><Inspector graph={graph} n={node} onClose={() => setSel(null)} onSelect={select} /></div>
          </>
        )}
      </div>
    </div>
  );
}
