import { useState } from "react";
import { useOsa, type ViewId } from "../ctx";
import { HOME_ITEM, NAV, type NavItem } from "../nav";
import { ICON } from "../brand/icons";
import { Icon, Logo, Mono, Status, Empty, ThemeSwitch, OsaIcon } from "../ui/primitives";
import Palette from "./Palette";
import Home from "./Home";
import World from "./World";
import Missions from "./Missions";
import Trace from "./Trace";
import Proofs from "./Proofs";
import BuildWorkspace from "./BuildWorkspace";
import { BUILD_LABELS, type BuildPage } from "../build";
import Replay from "./Replay";
import Intelligence from "./Intelligence";

const TITLES: Record<string, string> = { home: "Home", world: "Knowledge World", missions: "Missions", trace: "Tracing", proofs: "Proofs", replay: "Replay" };

function NavList({ compact, onPick }: { compact: boolean; onPick?: () => void }) {
  const { view, go } = useOsa();
  const [closed, setClosed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("osa.nav.closed") ?? "[]")); } catch { return new Set(); }
  });
  const toggle = (t: string) => setClosed((c) => { const n = new Set(c); n.has(t) ? n.delete(t) : n.add(t); try { localStorage.setItem("osa.nav.closed", JSON.stringify([...n])); } catch { /* storage unavailable */ } return n; });
  const firstFor = new Map<string, string>(); for (const it of [HOME_ITEM, ...NAV.flatMap((g) => g.items)]) if (it.built && !firstFor.has(it.view)) firstFor.set(it.view, it.label);
  const item = (it: NavItem, k: string) => {
    const active = it.view === view && it.built && firstFor.get(view) === it.label;
    return (
      <button key={k} onClick={() => { go(it.view); onPick?.(); }} title={compact ? it.label : it.built ? undefined : `${it.label} · not built yet`} aria-current={active ? "page" : undefined}
        className={`osa-nav-item focus-ring group relative flex w-full items-center gap-3 rounded-md text-left text-[13.5px] ${compact ? "tap justify-center px-0" : "h-10 px-2.5"} ${active ? "is-active bg-raise text-fg sel-mark" : it.built ? "text-fg/85 hover:bg-raise/60 hover:text-fg" : "text-dim hover:bg-raise/40"}`}>
        <OsaIcon src={it.icon} size={compact ? 28 : 24} className={`osa-nav-icon ${it.built ? "" : "opacity-80"}`} />
        {!compact && <><span className="flex-1 truncate">{it.label}</span>{!it.built && <span className="text-[9px] font-medium uppercase tracking-[.14em] text-dim/70">soon</span>}</>}
      </button>
    );
  };
  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-2" aria-label="Primary">
      {item(HOME_ITEM, "home")}
      {NAV.map((g) => {
        const shut = !compact && closed.has(g.title);
        const hasActive = g.items.some((it) => it.view === view && it.built && firstFor.get(view) === it.label);
        return (
          <div key={g.title} className="mt-3">
            {compact ? <div className="mx-3 mb-1 h-px bg-line" /> : (
              <button type="button" onClick={() => toggle(g.title)} aria-expanded={!shut} className="focus-ring label flex h-7 w-full items-center gap-2 rounded px-2.5 hover:text-fg">
                <span className="flex-1 text-left">{g.title}</span>
                {shut && hasActive && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                <span className="text-[10px] transition-transform" style={{ transform: shut ? "rotate(-90deg)" : "none" }}>▾</span>
              </button>
            )}
            {!shut && g.items.map((it, i) => item(it, `${g.title}${i}`))}
          </div>
        );
      })}
      <div className="mt-3">
        {compact ? <div className="mx-3 mb-1 h-px bg-line" /> : <div className="label flex h-7 items-center px-2.5">DOCS</div>}
        {/* Static documentation published next to the dashboard by scripts/build-dashboard.cjs. */}
        <a href="/docs" title={compact ? "Docs" : undefined}
          className={`osa-nav-item focus-ring flex w-full items-center gap-3 rounded-md text-left text-[13.5px] text-fg/85 hover:bg-raise/60 hover:text-fg ${compact ? "tap justify-center px-0" : "h-10 px-2.5"}`}>
          <OsaIcon src={ICON.knowledge} size={compact ? 28 : 24} className="osa-nav-icon" />
          {!compact && <span className="flex-1 truncate">Docs</span>}
        </a>
      </div>
    </nav>
  );
}

function LiveRail() {
  const { data, runId } = useOsa();
  const run = data.runs.find((r) => r.run_id === runId) ?? data.runs[0];
  const [open, setOpen] = useState<number | null>(null);
  if (!run) return null;
  return (
    <aside className="hidden w-[210px] shrink-0 flex-col border-l border-line bg-ink xl:flex" aria-label="Live system rail">
      <div className="flex h-11 items-center justify-between border-b border-line px-3"><span className="label">System rail</span><Status v={run.verdict} /></div>
      <div className="mono border-b border-line px-3 py-1.5 text-[10px] text-dim">{run.proof.mission_id} · order by sequence (events carry no timestamps)</div>
      <ol className="flex-1 overflow-y-auto py-1">
        {run.events.map((e) => (
          <li key={e.event_id}>
            <button onClick={() => setOpen(open === e.sequence ? null : e.sequence)} className="focus-ring w-full px-3 py-1.5 text-left hover:bg-raise/50">
              <div className="mono text-[10px] text-dim">#{String(e.sequence).padStart(2, "0")}{e.agent_id ? ` · ${e.agent_id}` : ""}</div>
              <div className={`mono text-[11px] ${e.type.includes("FAILED") ? "text-bad" : e.type.includes("VERIFIED") || e.type === "VERIFICATION_PASSED" ? "text-ok" : "text-fg"}`}>{e.type}</div>
              {open === e.sequence && <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-2 text-[10px] text-dim">{JSON.stringify(e.payload, null, 1)}</pre>}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export default function Shell({ palette, closePalette }: { palette: boolean; closePalette: () => void }) {
  const { view, source, openPalette } = useOsa();
  const [drawer, setDrawer] = useState(false);
  let body;
  const v: ViewId = view;
  if (v === "home") body = <Home />;
  else if (v === "world") body = <World />;
  else if (v === "missions") body = <Missions />;
  else if (v === "trace") body = <Trace />;
  else if (v === "proofs") body = <Proofs />;
  else if (v === "replay") body = <Replay />;
  else if (v.startsWith("build:")) body = <BuildWorkspace page={v.slice(6) as BuildPage} />;
  else if (v.startsWith("intel:")) body = <Intelligence id={v.slice(6)} />;
  else {
    const name = v.replace("pending:", "");
    body = <Empty title={`${name.toUpperCase()} · NOT BUILT YET`} body={`${name} has no view in this pass, and osa-proof does not expose the data for it yet. Nothing is shown rather than something invented.`} steps={["Knowledge World", "Missions", "Tracing", "Proofs", "Replay"].map((s) => `${s} is live`)} />;
  }
  const title = v.startsWith("build:") ? BUILD_LABELS[v.slice(6) as BuildPage] : v.startsWith("intel:") ? `Intelligence · ${v.slice(6)}` : TITLES[v] ?? v.replace("pending:", "");
  return (
    <div className="flex h-[100dvh] bg-void">
      <aside className="osa-sidebar hidden w-[252px] shrink-0 flex-col border-r border-line bg-ink lg:flex">
        <SidebarTop />
        <NavList compact={false} />
      </aside>
      <aside className="osa-sidebar hidden w-[64px] shrink-0 flex-col border-r border-line bg-ink md:flex lg:hidden">
        <div className="grid h-16 place-items-center border-b border-line"><Logo size={30} /></div>
        <NavList compact />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-ink px-3 md:px-5">
          <button className="focus-ring tap grid w-11 place-items-center text-dim md:hidden" aria-label="Open navigation" onClick={() => setDrawer(true)}><Icon d="M4 7h16M4 12h16M4 17h16" className="h-5 w-5" /></button>
          <h1 className="text-[13px] font-bold uppercase tracking-[.14em]">{title}</h1>
          <button onClick={openPalette} className="focus-ring tap glass ml-auto flex max-w-[380px] flex-1 items-center gap-2 rounded-md px-3 text-left text-[13px] text-dim hover:text-dim md:ml-6 md:mr-auto">
            <Icon d="M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5" /><span className="hidden flex-1 truncate sm:inline">Search agents, missions, proofs…</span><span className="flex-1 sm:hidden">Search</span><kbd className="mono hidden rounded border border-line px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
          </button>
          <div className="hidden md:block"><ThemeSwitch /></div>
          <div className="hidden text-right lg:block"><Status v={source.kind} /><div className="mono max-w-[240px] truncate text-[10px] text-dim">{source.detail}</div></div>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto" key={v}><div className="reveal h-full">{body}</div></main>
          {!v.startsWith("build:") && <LiveRail />}
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="slide-in absolute inset-y-0 left-0 flex w-[84vw] max-w-[320px] flex-col border-r border-line bg-ink">
            <SidebarTop />
            <div className="mx-3 mb-3 flex flex-col gap-2"><button onClick={() => { setDrawer(false); openPalette(); }} className="focus-ring tap glass rounded-md px-3 text-left text-[13px] text-dim">Search / commands</button><ThemeSwitch /></div>
            <NavList compact={false} onPick={() => setDrawer(false)} />
          </div>
        </div>
      )}
      {palette && <Palette onClose={closePalette} />}
    </div>
  );
}

function SidebarTop() {
  const { data } = useOsa();
  return (
    <div className="border-b border-line p-3">
      <div className="mb-3 flex items-center gap-3"><Logo size={48} /><div className="leading-tight"><div className="font-display text-[13px] text-hero">OSA</div><div className="font-display text-[9px] text-dim">FRAMEWORK</div></div></div>
      <div className="glass rounded-md px-2.5 py-1.5"><div className="label">Workspace</div><Mono className="text-[12px]">{data.team.organization_id} / {data.team.project_id}</Mono></div>
    </div>
  );
}
