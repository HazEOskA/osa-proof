import SolarWorld from "../ui/SolarWorld";
import { Status, Mono } from "../ui/primitives";
import { useState } from "react";
import { useOsa, type ViewId } from "../ctx";
import { CARD } from "../brand/icons";
import { NAV } from "../nav";

const destination = (view: ViewId) => {
  const item = NAV.flatMap((group) => group.items).find((item) => item.view === view);
  if (!item) throw new Error(`Missing navigation destination: ${view}`);
  return { view: item.view, built: item.built };
};

const LAUNCH: { label: string; icon: string; color: string; view: ViewId; built: boolean; focus?: string }[] = [
  { label: "World", icon: CARD.world, color: "#4d9bff", view: "world", built: true },
  { label: "Agents", icon: CARD.agents, color: "#f8a541", ...destination("build:agents") },
  { label: "Minions", icon: CARD.minions, color: "#36d6f5", ...destination("build:agents") },
  { label: "Workers", icon: CARD.workers, color: "#ff8a3d", ...destination("build:agents") },
  { label: "Missions", icon: CARD.missions, color: "#a57bff", view: "missions", built: true },
  { label: "Execution", icon: CARD.execution, color: "#2ee07a", ...destination("missions") },
  { label: "Knowledge", icon: CARD.knowledge, color: "#4d9bff", view: "world", built: true, focus: "repo" },
  { label: "Repos", icon: CARD.repos, color: "#ff5fdc", view: "world", built: true, focus: "repo" },
  { label: "Tools", icon: CARD.tools, color: "#ff8a3d", ...destination("build:tools") },
  { label: "Team Mesh", icon: CARD.teammesh, color: "#a57bff", ...destination("build:mesh") },
  { label: "Observe", icon: CARD.observe, color: "#4d9bff", view: "trace", built: true },
  { label: "Deploy", icon: CARD.deploy, color: "#f8a541", view: "pending:Deployments", built: false },
];

export default function Home() {
  const { data, graph, source, go, openPalette, enterLayer } = useOsa();
  const [layerNote, setLayerNote] = useState("Select a layer to query the backend authority gate.");
  const verified = data.runs.filter((r) => r.verdict === "VERIFIED").length;
  const failed = data.runs.filter((r) => r.verdict === "FAILED").length;
  const anyModel = data.team.agents.some((a) => a.model_ref);
  const steps: { n: string; s: string; note: string }[] = [
    { n: "Connect Identity", s: "NOT CONNECTED", note: "osa-proof has no auth endpoint" },
    { n: "Connect GitHub", s: "UNKNOWN", note: "repo is public; no connection state exposed" },
    { n: "Connect Model", s: anyModel ? "DONE" : "UNKNOWN", note: anyModel ? "model_ref set" : "agents carry no model_ref" },
    { n: "Create Workspace", s: "DONE", note: `${data.team.organization_id} / ${data.team.project_id}` },
    { n: "Initialize Knowledge", s: "UNKNOWN", note: `${data.repo.docs.length} docs in graph; no knowledge store reported` },
    { n: "Create Agent", s: "DONE", note: `${data.team.agents.length} agents in Team Graph v${data.team.version}` },
    { n: "Run Mission", s: data.runs.length ? "DONE" : "PENDING", note: `${data.runs.length} runs captured` },
    { n: "Verify Proof", s: verified ? "DONE" : "PENDING", note: `${verified} VERIFIED · ${failed} FAILED` },
  ];
  const chips = ["@agent deploy", "@mission inspect", "@proof verify", "@runtime replay", "@repo analyze", "@world open"];
  const tone = (s: string) => (s === "DONE" ? "text-cyan" : s === "PENDING" ? "text-warn" : "text-dim");
  return (
    <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <div>
        <div className="label mb-2">OSA SYSTEM · LIVE CONTROL PLANE</div>
        <h2 className="font-display text-[clamp(20px,3vw,40px)] font-normal leading-[1.3] text-hero">What will OSA <span className="text-brand">execute</span> today?</h2>
        <button onClick={openPalette} className="focus-ring tap glass mt-5 flex w-full max-w-[720px] items-center gap-3 rounded-lg px-4 text-left text-[14px] text-dim hover:text-dim">
          <span className="mono text-brand">›</span><span className="flex-1 truncate">Search agents, missions, proofs, traces, repos or commands…</span><kbd className="mono hidden rounded border border-line px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
        </button>
        <div className="mt-3 flex flex-wrap gap-2">{chips.map((c) => <button key={c} onClick={openPalette} className="focus-ring mono tap rounded-md border border-line px-2.5 text-[11px] text-dim hover:border-line2 hover:text-fg">{c}</button>)}</div>
        <p className="mono mt-2 text-[10.5px] text-dim">@-commands are examples; palette search and actions work, @-syntax is not wired yet.</p>
      </div>


      <section aria-label="Layer access" className="glass rounded-lg px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="label mr-1">LAYER AUTHORITY</span>
          {data.layers.map((layer) => (
            <button
              key={layer.layer_id}
              type="button"
              onClick={async () => {
                setLayerNote(`Checking ${layer.label}…`);
                try {
                  const result = await enterLayer(layer.layer_id);
                  const gate = result.gate?.requirements?.length ? ` · ${result.gate.requirements.join(", ")}` : "";
                  setLayerNote(`${result.layer.label} · ${result.decision}${gate}`);
                } catch (error) {
                  setLayerNote(`ERROR · ${error instanceof Error ? error.message : String(error)}`);
                }
              }}
              className="focus-ring tap rounded-md border border-line2 bg-panel px-2.5 text-[10.5px] font-semibold uppercase tracking-[.1em] text-fg hover:bg-raise"
            >
              {layer.label}
            </button>
          ))}
        </div>
        <p className="mono break-words text-[10.5px] text-dim">{layerNote}</p>
      </section>

      <section aria-label="Launch">
        <div className="label mb-3">LAUNCH</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-3">
          {LAUNCH.map((c) => (
            <button key={c.label} type="button" onClick={() => go(c.view, c.focus ? { focus: c.focus } : undefined)} title={c.built ? c.label : `${c.label} · not built yet`}
              className="osa-card focus-ring group relative flex flex-col items-center gap-2 rounded-md border bg-panel px-2 pb-2.5 pt-3" style={{ ["--c" as string]: c.color, borderColor: `${c.color}55` }}>
              <img src={c.icon} alt="" aria-hidden className={`h-12 w-12 object-contain transition-transform group-hover:scale-110 ${c.built ? "" : "opacity-80"}`} draggable={false} />
              <span className="text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: c.built ? c.color : undefined }}>{c.label}</span>
              {!c.built && <span className="absolute right-1.5 top-1.5 text-[8px] font-medium uppercase tracking-[.12em] text-dim/70">soon</span>}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <section className="glass relative h-[340px] overflow-hidden rounded-xl lg:h-[440px]">
          <SolarWorld graph={graph} interactive={false} ambient className="absolute inset-0" />
          <button aria-label="Open Knowledge World" onClick={() => go("world")} className="focus-ring absolute inset-0" />
          <div className="pointer-events-none absolute left-4 top-3"><div className="label">Knowledge World</div><div className="mono text-[11px] text-dim">{graph.nodes.length} entities · {graph.edges.length} relations</div></div>
          <div className="pointer-events-none absolute bottom-3 left-4"><span className="mono rounded border border-line bg-ink/80 px-2 py-1 text-[11px] text-cyan">Open world →</span></div>
        </section>

        <section aria-label="Activate OSA">
          <div className="label mb-3">ACTIVATE OSA</div>
          <ol className="relative">
            <span className="absolute bottom-3 left-[9px] top-3 w-px bg-line" aria-hidden />
            {steps.map((s, i) => (
              <li key={s.n} className="relative flex gap-4 py-2">
                <span className={`z-10 mt-0.5 grid h-[19px] w-[19px] place-items-center rounded-full border bg-ink mono text-[9px] ${s.s === "DONE" ? "border-cyan text-cyan" : "border-line2 text-dim"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="text-[14px]">{s.n}</span><span className={`mono text-[10px] tracking-wider ${tone(s.s)}`}>{s.s}</span></div><div className="mono truncate text-[11px] text-dim">{s.note}</div></div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section aria-label="Missions">
        <div className="mb-2 flex items-center justify-between"><span className="label">RECENT MISSIONS</span><Mono className="text-[10.5px] text-dim">{source.kind} · {source.detail}</Mono></div>
        <div className="divide-y divide-line rounded-lg border border-line">
          {data.runs.map((r) => {
            const m = data.missions.find((x) => x.mission_id === r.proof.mission_id);
            return (
              <button key={r.run_id} onClick={() => go("trace", { runId: r.run_id })} className="focus-ring tap flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-left hover:bg-panel">
                <span className="mono w-16 text-[12px]">{r.proof.mission_id}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{m?.objective ?? "mission"}</span>
                <span className="mono hidden text-[11px] text-dim sm:inline">{r.events.length} events · {r.evidence.length} evidence</span>
                <Status v={r.verdict} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
