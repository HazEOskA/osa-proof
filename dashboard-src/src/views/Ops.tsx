import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useOsa } from "../ctx";
import { requestJson } from "../data/data";
import type { Run } from "../data/types";
import { verifyRun, type Check } from "../lib/verify";
import RunPicker from "../ui/RunPicker";
import { useRun } from "../lib/hooks";
import { Kv, Mono, Section, Status, ThemeSwitch, short } from "../ui/primitives";

// Operational screens. Each one is computed from data that exists: the runs the dashboard holds (snapshot plus
// live executions), their events, evidence and sealed receipts, the Team Graph, and the API's own status routes.
// Nothing here is invented; when a source is unreachable the screen says so.

interface BuildStatus {
  mode?: string; provider?: string; model?: string; fallbacks?: string[]; auth_mode?: string;
  executors?: string[]; persistence?: string; protocols?: Record<string, string>; [k: string]: unknown;
}
interface ModuleReport { id: string; label: string; status: string; depends_on: string[]; blocked_by: string[]; proofs: { ok: boolean }[] }

function useApi<T>(path: string): { data: T | null; error: string } {
  const [state, setState] = useState<{ data: T | null; error: string }>({ data: null, error: "" });
  useEffect(() => {
    let alive = true;
    requestJson<T>(path).then((data) => alive && setState({ data, error: "" })).catch((e: Error) => alive && setState({ data: null, error: e.message }));
    return () => { alive = false; };
  }, [path]);
  return state;
}

function Page({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6 md:px-8">
      <header className="border-b border-line pb-5">
        <div className="label mb-2">{eyebrow}</div>
        <h2 className="font-display text-[clamp(20px,3vw,34px)] font-normal">{title}</h2>
        <p className="mt-1 max-w-[72ch] text-[14px] text-dim">{lead}</p>
      </header>
      {children}
    </div>
  );
}

function Tiles({ items }: { items: { k: string; v: ReactNode; s?: string }[] }) {
  return (
    <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {items.map((t) => (
        <li key={t.k} className="bg-ink p-3"><span className="label">{t.k}</span>{t.s && <div className="mt-1"><Status v={t.s} /></div>}<div className="mono mt-2 text-[20px] tabular-nums">{t.v}</div></li>
      ))}
    </ol>
  );
}

function Unreachable({ what, error }: { what: string; error: string }) {
  return <p className="text-[13px] text-bad">{what} unreachable: {error}. Nothing is shown rather than something invented.</p>;
}

function missionOf(run: Run) { return run.proof.mission_id; }

// ── Logs ─────────────────────────────────────────────────────────────────────────────────────────────
export function Logs() {
  const { data } = useOsa();
  const [q, setQ] = useState("");
  const [type, setType] = useState("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => data.runs.flatMap((r) => r.events.map((e) => ({ run: r, e }))), [data.runs]);
  const types = useMemo(() => ["ALL", ...[...new Set(rows.map((x) => x.e.type))].sort()], [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(({ run, e }) => (type === "ALL" || e.type === type) &&
    (!needle || `${missionOf(run)} ${e.type} ${e.agent_id ?? ""} ${JSON.stringify(e.payload)}`.toLowerCase().includes(needle)));
  return (
    <Page eyebrow="OBSERVE · LOGS" title="Runtime logs" lead={`Every runtime event from the ${data.runs.length} runs this dashboard holds, in run and sequence order. Events carry sequence numbers, not timestamps.`}>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="logs-q">Filter</label>
        <input id="logs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by mission, type, agent or payload"
          className="focus-ring glass min-w-0 flex-1 rounded-md px-3 py-2 text-[13px]" />
        <label className="sr-only" htmlFor="logs-type">Event type</label>
        <select id="logs-type" value={type} onChange={(e) => setType(e.target.value)} className="focus-ring glass rounded-md px-3 py-2 text-[13px]">
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="mono text-[11px] text-dim">{shown.length} of {rows.length} events</div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-panel text-dim"><tr><th className="px-3 py-2">Mission</th><th className="px-3 py-2">#</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Payload</th></tr></thead>
          <tbody>
            {shown.map(({ run, e }) => {
              const key = `${run.run_id}:${e.sequence}`;
              return (
                <tr key={key} className="border-t border-line align-top">
                  <td className="mono px-3 py-1.5">{missionOf(run)}</td>
                  <td className="mono px-3 py-1.5 tabular-nums">{e.sequence}</td>
                  <td className={`mono px-3 py-1.5 ${e.type.includes("FAILED") ? "text-bad" : e.type.includes("VERIFIED") || e.type === "VERIFICATION_PASSED" ? "text-ok" : ""}`}>{e.type}</td>
                  <td className="mono px-3 py-1.5 text-dim">{e.agent_id ?? "runtime"}</td>
                  <td className="px-3 py-1.5">
                    <button className="focus-ring mono max-w-[48ch] truncate text-left text-dim hover:text-fg" onClick={() => setOpen(open === key ? null : key)}>{JSON.stringify(e.payload)}</button>
                    {open === key && <pre className="mono mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-panel p-2 text-[11px]">{JSON.stringify(e.payload, null, 2)}</pre>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────────────────────────────
function Bars({ rows }: { rows: { k: string; v: number; c?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.k} className="grid grid-cols-[minmax(0,160px)_1fr_40px] items-center gap-3 text-[12px]">
          <span className="mono truncate text-dim">{r.k}</span>
          <span className="h-2 rounded-full bg-raise"><span className="block h-2 rounded-full" style={{ width: `${(r.v / max) * 100}%`, background: r.c ?? "var(--cyan)" }} /></span>
          <span className="mono text-right tabular-nums">{r.v}</span>
        </li>
      ))}
    </ul>
  );
}

export function Metrics() {
  const { data } = useOsa();
  const m = useMemo(() => {
    const runs = data.runs;
    const by = (v: string) => runs.filter((r) => r.verdict === v).length;
    const evidence = runs.flatMap((r) => r.evidence);
    const obs = runs.flatMap((r) => r.observations);
    const reqs = runs.flatMap((r) => r.proof.requirement_verdicts);
    const calls = evidence.filter((e) => e.kind === "provider_call");
    const attempts = calls.reduce((n, e) => n + (typeof e.data.attempts === "number" ? e.data.attempts : 1), 0);
    const kinds = new Map<string, number>(); for (const e of evidence) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    return { runs: runs.length, verified: by("VERIFIED"), failed: by("FAILED"), incomplete: by("INCOMPLETE"), events: runs.reduce((n, r) => n + r.events.length, 0),
      evidence: evidence.length, obsOk: obs.filter((o) => o.ok).length, obs: obs.length, reqPass: reqs.filter((r) => r.verdict === "VERIFIED").length, reqs: reqs.length,
      calls: calls.length, attempts, kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]) };
  }, [data.runs]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <Page eyebrow="OBSERVE · METRICS" title="Run metrics" lead="Computed in the browser from the runs this dashboard holds. Durations are not shown: events carry sequence numbers, not timestamps.">
      <Tiles items={[
        { k: "Runs", v: m.runs }, { k: "Verified", v: `${m.verified} · ${pct(m.verified, m.runs)}`, s: "VERIFIED" },
        { k: "Requirements passed", v: `${m.reqPass}/${m.reqs}` }, { k: "Verifier observations ok", v: `${m.obsOk}/${m.obs}` },
      ]} />
      <Tiles items={[
        { k: "Events", v: m.events }, { k: "Evidence records", v: m.evidence },
        { k: "Provider calls", v: m.calls }, { k: "Provider attempts", v: m.attempts },
      ]} />
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Verdicts"><Bars rows={[{ k: "VERIFIED", v: m.verified, c: "var(--ok)" }, { k: "FAILED", v: m.failed, c: "var(--bad)" }, { k: "INCOMPLETE", v: m.incomplete, c: "var(--warn)" }]} /></Section>
        <Section title="Evidence by kind"><Bars rows={m.kinds.map(([k, v]) => ({ k, v }))} /></Section>
      </div>
    </Page>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────────────────────────────────
export function Timeline() {
  const run = useRun();
  const lanes = useMemo(() => ["runtime", ...[...new Set(run.events.map((e) => e.agent_id).filter(Boolean) as string[])]], [run]);
  return (
    <Page eyebrow="WORLD · TIMELINE" title="Run timeline" lead="Each event of one run in sequence order, placed in the lane of the agent that produced it. Runtime events without an agent sit in the runtime lane.">
      <RunPicker />
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12px]">
          <thead className="bg-panel text-dim"><tr><th className="px-3 py-2 text-left">#</th>{lanes.map((l) => <th key={l} className="mono px-3 py-2 text-left">{l}</th>)}</tr></thead>
          <tbody>
            {run.events.map((e) => (
              <tr key={e.event_id} className="border-t border-line">
                <td className="mono px-3 py-1.5 tabular-nums text-dim">{String(e.sequence).padStart(2, "0")}</td>
                {lanes.map((l) => (
                  <td key={l} className="px-3 py-1.5">
                    {(e.agent_id ?? "runtime") === l && <span className={`mono inline-flex items-center gap-2 ${e.type.includes("FAILED") ? "text-bad" : e.type.includes("VERIFIED") || e.type === "VERIFICATION_PASSED" ? "text-ok" : "text-fg"}`}><span className="h-2 w-2 rounded-full bg-current" />{e.type}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ── Graph drawing shared by Topology and Dependencies ────────────────────────────────────────────────
interface GNodeLite { id: string; title: string; sub: string; status?: string }
function LayeredGraph({ nodes, edges }: { nodes: GNodeLite[]; edges: { from: string; to: string; label?: string }[] }) {
  // Longest-path layering: a node sits one column right of its furthest predecessor.
  const depth = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < nodes.length; i++) for (const e of edges) if (depth.has(e.from) && depth.has(e.to)) depth.set(e.to, Math.max(depth.get(e.to)!, depth.get(e.from)! + 1));
  const cols = new Map<number, GNodeLite[]>(); for (const n of nodes) { const d = depth.get(n.id)!; cols.set(d, [...(cols.get(d) ?? []), n]); }
  const W = 210, H = 64, GX = 70, GY = 22, pad = 16;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, list] of cols) list.forEach((n, i) => pos.set(n.id, { x: pad + d * (W + GX), y: pad + i * (H + GY) }));
  const width = pad * 2 + (Math.max(...cols.keys(), 0) + 1) * (W + GX) - GX;
  const height = pad * 2 + Math.max(...[...cols.values()].map((l) => l.length), 1) * (H + GY) - GY;
  const color = (s?: string) => s === "LIVE" ? "var(--ok)" : s === "PREVIEW" ? "var(--warn)" : s === "SOON" ? "var(--faint)" : "var(--cyan)";
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-ink">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Graph">
        <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--dim)" /></marker></defs>
        {edges.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return null;
          const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
          return <g key={i}><path d={`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2 - 2} ${y2}`} fill="none" stroke="var(--dim)" strokeWidth="1.4" markerEnd="url(#arr)" />{e.label && <text x={mx} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize="10" fill="var(--dim)" className="mono">{e.label}</text>}</g>;
        })}
        {nodes.map((n) => { const p = pos.get(n.id)!; return (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`}>
            <rect width={W} height={H} rx="8" fill="var(--panel)" stroke={color(n.status)} strokeWidth="1.2" />
            <circle cx="14" cy="18" r="4" fill={color(n.status)} />
            <text x="26" y="22" fontSize="13" fill="var(--fg)">{n.title}</text>
            <text x="12" y="44" fontSize="11" fill="var(--dim)" className="mono">{n.sub.length > 30 ? n.sub.slice(0, 29) + "…" : n.sub}</text>
          </g>
        ); })}
      </svg>
    </div>
  );
}

// ── Topology ─────────────────────────────────────────────────────────────────────────────────────────
export function Topology() {
  const { data } = useOsa();
  const t = data.team;
  return (
    <Page eyebrow="OBSERVE · TOPOLOGY" title={`Team ${t.team_id} v${t.version}`} lead="The canonical Team Graph: every agent with its executor ref, and every edge the runtime follows.">
      <LayeredGraph nodes={t.agents.map((a) => ({ id: a.agent_id, title: `${a.agent_id} · ${a.role}`, sub: a.executor_ref }))} edges={t.edges.map((e) => ({ from: e.from_agent_id, to: e.to_agent_id, label: e.kind }))} />
      <Section title="Agents">
        {t.agents.map((a) => <Kv key={a.agent_id} k={a.agent_id}>{a.executor_ref}{a.model_ref ? ` · ${a.model_ref}` : ""}</Kv>)}
      </Section>
    </Page>
  );
}

// ── Dependencies ─────────────────────────────────────────────────────────────────────────────────────
export function Dependencies() {
  const { data: reports, error } = useApi<ModuleReport[]>("/intelligence");
  return (
    <Page eyebrow="WORLD · DEPENDENCIES" title="Module dependencies" lead="Intelligence modules and what each one depends on. A module is LIVE only when its proofs pass and every dependency is LIVE; the API computes this, the page only draws it.">
      {error && <Unreachable what="GET /api/intelligence" error={error} />}
      {reports && <>
        <LayeredGraph nodes={reports.map((r) => ({ id: r.id, title: r.label, sub: `${r.status} · proofs ${r.proofs.filter((p) => p.ok).length}/${r.proofs.length}`, status: r.status }))}
          edges={reports.flatMap((r) => r.depends_on.map((d) => ({ from: d, to: r.id })))} />
        <Section title="Blocked">{reports.filter((r) => r.blocked_by.length).length === 0 ? <p className="text-[13px] text-dim">No module is blocked by a dependency.</p> :
          reports.filter((r) => r.blocked_by.length).map((r) => <Kv key={r.id} k={r.label}>waits on {r.blocked_by.join(", ")}</Kv>)}</Section>
      </>}
    </Page>
  );
}

// ── Audit trail ──────────────────────────────────────────────────────────────────────────────────────
export function AuditTrail() {
  const { data } = useOsa();
  const [checks, setChecks] = useState<Record<string, Check[] | string>>({});
  useEffect(() => {
    let alive = true;
    for (const r of data.runs) verifyRun(r).then((c) => alive && setChecks((m) => ({ ...m, [r.run_id]: c }))).catch((e: Error) => alive && setChecks((m) => ({ ...m, [r.run_id]: e.message })));
    return () => { alive = false; };
  }, [data.runs]);
  return (
    <Page eyebrow="PROOF · AUDIT TRAIL" title="Receipt audit trail" lead="Every sealed receipt the dashboard holds, re-verified in this browser: digests of evidence, observations and final output are recomputed and compared with the receipt.">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-panel text-dim"><tr><th className="px-3 py-2">Mission</th><th className="px-3 py-2">Verdict</th><th className="px-3 py-2">proof_id</th><th className="px-3 py-2">evidence_root</th><th className="px-3 py-2">Re-verified</th></tr></thead>
          <tbody>
            {data.runs.map((r) => {
              const c = checks[r.run_id];
              const bad = Array.isArray(c) ? c.filter((x) => !x.ok) : [];
              return (
                <tr key={r.run_id} className="border-t border-line align-top">
                  <td className="mono px-3 py-2">{missionOf(r)}</td>
                  <td className="px-3 py-2"><Status v={r.verdict} /></td>
                  <td className="mono px-3 py-2">{short(r.proof.proof_id)}</td>
                  <td className="mono px-3 py-2">{short(r.proof.evidence_root)}</td>
                  <td className="px-3 py-2">{c === undefined ? <span className="text-dim">checking…</span> : typeof c === "string" ? <span className="text-bad">{c}</span> :
                    <><Status v={bad.length ? "MISMATCH" : "MATCH"} label={`${c.length - bad.length}/${c.length} checks`} />{bad.map((b) => <div key={b.id} className="mono text-[11px] text-bad">{b.label}</div>)}</>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ── Monitoring ───────────────────────────────────────────────────────────────────────────────────────
export function Monitoring() {
  const { data, source } = useOsa();
  const status = useApi<BuildStatus>("/build/status");
  const intel = useApi<ModuleReport[]>("/intelligence");
  const failed = data.runs.filter((r) => r.verdict !== "VERIFIED");
  const count = (s: string) => intel.data?.filter((r) => r.status === s).length ?? 0;
  return (
    <Page eyebrow="OBSERVE · MONITORING" title="System health" lead="Live checks against the API, plus the runs that did not verify. Each tile is a request made when this page opened.">
      <Tiles items={[
        { k: "API", v: status.data ? "reachable" : status.error ? "unreachable" : "checking", s: status.data ? "LIVE" : status.error ? "FAILED" : "UNKNOWN" },
        { k: "Data source", v: source.kind, s: source.kind },
        { k: "Intelligence LIVE", v: intel.data ? `${count("LIVE")}/${intel.data.length}` : "—" },
        { k: "Runs not verified", v: `${failed.length}/${data.runs.length}`, s: failed.length ? "FAILED" : "VERIFIED" },
      ]} />
      {status.error && <Unreachable what="GET /api/build/status" error={status.error} />}
      <Section title="Runs that did not verify">
        {failed.length === 0 ? <p className="text-[13px] text-dim">Every run held by the dashboard is VERIFIED.</p> : failed.map((r) => (
          <div key={r.run_id} className="py-1.5"><div className="flex items-center justify-between"><Mono className="text-[12px]">{missionOf(r)}</Mono><Status v={r.verdict} /></div>
            <div className="text-[12px] text-dim">{r.proof.runtime_failure ?? r.proof.requirement_verdicts.filter((v) => v.verdict !== "VERIFIED").map((v) => `${v.requirement_id}: ${v.reason}`).join("; ")}</div></div>
        ))}
      </Section>
    </Page>
  );
}

// ── Runtime ──────────────────────────────────────────────────────────────────────────────────────────
export function Runtime() {
  const { data } = useOsa();
  const { data: status, error } = useApi<BuildStatus>("/build/status");
  return (
    <Page eyebrow="RUNTIME · RUNTIME" title="Runtime" lead="How the API executes agents right now, which executor refs it has registered, and whether every agent in the Team Graph resolves to one.">
      {error && <Unreachable what="GET /api/build/status" error={error} />}
      {status && <>
        <Tiles items={[
          { k: "Execution mode", v: status.mode ?? "—" }, { k: "Provider", v: status.provider ? `${status.provider}` : "none (fixture)" },
          { k: "Registered executors", v: status.executors?.length ?? "—" }, { k: "Persistence", v: status.persistence ?? "—" },
        ]} />
        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Team Graph agents → executor">
            {data.team.agents.map((a) => {
              const ok = status.executors?.includes(a.executor_ref);
              return <div key={a.agent_id} className="flex items-center justify-between gap-3 py-1.5"><Mono className="text-[12px]">{a.agent_id} → {a.executor_ref}</Mono><Status v={ok ? "PASS" : "MISMATCH"} label={ok ? "registered" : "missing"} /></div>;
            })}
          </Section>
          <Section title="Registered executor refs">
            <ul className="mono space-y-1 text-[12px]">{(status.executors ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
          </Section>
        </div>
      </>}
    </Page>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────────────────────────────
export function Settings() {
  const { data: status, error } = useApi<BuildStatus>("/build/status");
  return (
    <Page eyebrow="SYSTEM · SETTINGS" title="Settings" lead="Server configuration comes from environment variables and is read-only here. Changing it means changing the deployment's environment, never a browser flag.">
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Server (GET /api/build/status)">
          {error && <Unreachable what="GET /api/build/status" error={error} />}
          {status && <>
            <Kv k="OSA_EXECUTION_MODE">{status.mode ?? "—"}</Kv>
            <Kv k="OSA_AUTH_MODE">{status.auth_mode ?? "—"}</Kv>
            <Kv k="OSA_PROVIDER / OSA_MODEL">{status.provider ? `${status.provider} / ${status.model}` : "not set (fixture mode)"}</Kv>
            <Kv k="OSA_MODEL_FALLBACKS">{status.fallbacks?.join(", ") || "none"}</Kv>
            <Kv k="persistence">{status.persistence ?? "—"}</Kv>
            {Object.entries(status.protocols ?? {}).map(([k, v]) => <Kv key={k} k={k}>{v}</Kv>)}
          </>}
        </Section>
        <Section title="This browser">
          <div className="flex items-center justify-between py-1.5"><span className="text-[13px] text-dim">Theme</span><ThemeSwitch /></div>
          <div className="flex items-center justify-between py-1.5"><span className="text-[13px] text-dim">Collapsed sidebar groups</span>
            <button className="focus-ring rounded-md border border-line px-3 py-1 text-[12px] hover:bg-raise" onClick={() => { try { localStorage.removeItem("osa.nav.closed"); location.reload(); } catch { /* storage unavailable */ } }}>Reset</button></div>
        </Section>
      </div>
    </Page>
  );
}

// ── Architecture ─────────────────────────────────────────────────────────────────────────────────────
export function Architecture() {
  const { data } = useOsa();
  const repo = data.repo;
  return (
    <Page eyebrow="WORLD · ARCHITECTURE" title="Architecture" lead={`Packages, apps and architecture documents of osa-proof, as captured in the dashboard snapshot (${data.captured_at.slice(0, 10)}).`}>
      <Tiles items={[{ k: "Packages", v: repo.packages.length }, { k: "Apps", v: repo.apps.length }, { k: "Architecture docs", v: repo.docs.length }, { k: "Team agents", v: data.team.agents.length }]} />
      <div className="grid gap-8 lg:grid-cols-3">
        <Section title="packages/">{repo.packages.map((p) => <div key={p} className="mono py-0.5 text-[12px]">{p}</div>)}</Section>
        <Section title="apps/">{repo.apps.map((p) => <div key={p} className="mono py-0.5 text-[12px]">{p}</div>)}</Section>
        <Section title="docs/">{repo.docs.map((p) => <div key={p} className="mono py-0.5 text-[12px]">{p}</div>)}</Section>
      </div>
    </Page>
  );
}

export const OPS_VIEWS: Record<string, ComponentType> = {
  logs: Logs, metrics: Metrics, timeline: Timeline, topology: Topology, dependencies: Dependencies,
  audit: AuditTrail, monitoring: Monitoring, runtime: Runtime, settings: Settings, architecture: Architecture,
};
