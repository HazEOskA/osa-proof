import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useOsa } from "../ctx";
import { requestJson } from "../data/data";
import { Kv, Mono, Section, Status, short } from "../ui/primitives";
import { sha256 } from "../lib/verify";

// Control-plane screens backed by the API (packages/control). Every button calls a real route; results and
// errors are shown as the API returns them. State lives in the API process (PROCESS_MEMORY).

interface Deployment { deployment_id: string; team_id: string; team_version: string; environment: string; graph_sha256: string; status: string; replaces: string | null; note: string; created_at: string }
interface Policy { policy_id: string; description: string; rule: { type: string; [k: string]: unknown }; enabled: boolean; policy_sha256: string }
interface Evaluation { allowed: boolean; decisions: { policy_id: string; ok: boolean; reason: string }[]; evaluation_sha256: string }
interface Org { organization_id: string; name: string; source: string; projects: string[] }
interface Secret { name: string; set: boolean; used_by: string }
interface Permissions { auth_mode: string; identity: { identity_id: string; roles: string[] } | null; permissions: { permission: string; method: string; path: string; enforced: string }[] }

function useLoad<T>(path: string): { data: T | null; error: string; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string }>({ data: null, error: "" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    requestJson<T>(path).then((data) => alive && setState({ data, error: "" })).catch((e: Error) => alive && setState({ data: null, error: e.message }));
    return () => { alive = false; };
  }, [path, n]);
  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
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
const Btn = ({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} className="focus-ring tap rounded-md border border-cyan/40 bg-cyan/10 px-3 text-[12px] text-cyan hover:bg-cyan/15 disabled:opacity-40">{children}</button>
);
const Err = ({ msg }: { msg: string }) => (msg ? <p className="mono text-[12px] text-bad">{msg}</p> : null);

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);
  return { busy, error, run };
}

// ── Deployments ──────────────────────────────────────────────────────────────────────────────────────
export function Deployments() {
  const { data } = useOsa();
  const list = useLoad<Deployment[]>("/deployments");
  const act = useAction();
  const [result, setResult] = useState<{ deployment_id: string; verdict: string; proof_id: string; team_version: string } | null>(null);
  const team = data.team;
  const post = <T,>(path: string, body: unknown) => requestJson<T>(path, { method: "POST", body: JSON.stringify(body) });
  const deploy = () => act.run(async () => {
    await post("/teams", team);
    await post("/deployments", { team_id: team.team_id, version: team.version, environment: "preview", note: "deployed from dashboard" });
    list.reload();
  });
  const runOn = (d: Deployment) => act.run(async () => {
    const mission = data.missions[0];
    const out = await post<{ deployment_id: string; run: { verdict: string; proof: { proof_id: string; team_version: string } } }>(`/deployments/${d.deployment_id}/run`, { mission });
    setResult({ deployment_id: out.deployment_id, verdict: out.run.verdict, proof_id: out.run.proof.proof_id, team_version: out.run.proof.team_version });
  });
  return (
    <Page eyebrow="RUNTIME · DEPLOYMENTS" title="Deployments" lead="A deployment pins one Team Graph version (by sha256) to preview or production. One is active per team and environment; deploying again supersedes it, rollback restores the previous one, and runs through a deployment always use the pinned graph after policies allow it.">
      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={deploy} disabled={act.busy}>Deploy {team.team_id} v{team.version} to preview</Btn>
        <Btn onClick={() => act.run(async () => { await post("/deployments/rollback", { team_id: team.team_id, environment: "preview" }); list.reload(); })} disabled={act.busy}>Roll back preview</Btn>
        <Btn onClick={() => act.run(async () => { await post("/deployments/rollback", { team_id: team.team_id, environment: "production" }); list.reload(); })} disabled={act.busy}>Roll back production</Btn>
      </div>
      <Err msg={act.error || list.error} />
      {result && <p className="text-[13px]">Run through <Mono>{short(result.deployment_id)}</Mono> on pinned v{result.team_version}: <Status v={result.verdict} /> <Mono className="text-dim">{short(result.proof_id)}</Mono></p>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-panel text-dim"><tr><th className="px-3 py-2">Deployment</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Env</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">graph_sha256</th><th className="px-3 py-2">Actions</th></tr></thead>
          <tbody>
            {list.data?.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-dim">No deployments in this API process yet. Deploy the current team to preview to create one.</td></tr>}
            {list.data?.map((d) => (
              <tr key={d.deployment_id} className="border-t border-line align-middle">
                <td className="mono px-3 py-2">{short(d.deployment_id)}</td>
                <td className="mono px-3 py-2">{d.team_id} v{d.team_version}</td>
                <td className="px-3 py-2">{d.environment}</td>
                <td className="px-3 py-2"><Status v={d.status === "ACTIVE" ? "LIVE" : d.status} label={d.status} /></td>
                <td className="mono px-3 py-2">{short(d.graph_sha256)}</td>
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {d.status === "ACTIVE" && <Btn onClick={() => runOn(d)} disabled={act.busy}>Run mission</Btn>}
                  {d.status === "ACTIVE" && d.environment === "preview" && <Btn onClick={() => act.run(async () => { await post(`/deployments/${d.deployment_id}/promote`, {}); list.reload(); })} disabled={act.busy}>Promote</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ── Policies ─────────────────────────────────────────────────────────────────────────────────────────
export function Policies() {
  const { data } = useOsa();
  const list = useLoad<Policy[]>("/policies");
  const act = useAction();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const refs = [...new Set(data.team.agents.map((a) => a.executor_ref))];
  const presets: { label: string; body: unknown }[] = [
    { label: "Max 5 agents", body: { policy_id: "max-5-agents", description: "Teams stay small", rule: { type: "max_agents", max: 5 } } },
    { label: "Only current executors", body: { policy_id: "known-executors", description: "Only executor refs the team uses today", rule: { type: "allowed_executor_refs", refs } } },
    { label: "At least 1 requirement", body: { policy_id: "has-requirements", description: "Missions must declare acceptance requirements", rule: { type: "min_requirements", min: 1 } } },
    { label: "No admin role", body: { policy_id: "no-admin-role", description: "No agent may hold the admin role", rule: { type: "forbidden_roles", roles: ["admin"] } } },
  ];
  const evaluate = () => act.run(async () => {
    await requestJson("/teams", { method: "POST", body: JSON.stringify(data.team) });
    setEvaluation(await requestJson<Evaluation>("/policies/evaluate", { method: "POST", body: JSON.stringify({ team_id: data.team.team_id, version: data.team.version, mission: data.missions[0] }) }));
  });
  return (
    <Page eyebrow="CONTROL · POLICIES" title="Policies" lead="Declarative rules checked before a deployment runs a mission. Every enabled policy must pass or the run is refused with 403 (fail closed). Unknown rule types are refused when added.">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => <Btn key={p.label} disabled={act.busy} onClick={() => act.run(async () => { await requestJson("/policies", { method: "POST", body: JSON.stringify(p.body) }); list.reload(); })}>Add: {p.label}</Btn>)}
        <Btn disabled={act.busy} onClick={evaluate}>Evaluate {data.team.team_id} v{data.team.version}</Btn>
      </div>
      <Err msg={act.error || list.error} />
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={`Policies · ${list.data?.length ?? 0}`}>
          {list.data?.length === 0 && <p className="text-[13px] text-dim">No policies. Add one of the presets above.</p>}
          {list.data?.map((p) => (
            <div key={p.policy_id} className="py-1.5">
              <div className="flex items-center justify-between gap-3"><Mono className="text-[12px]">{p.policy_id}</Mono>
                <button className="focus-ring text-[11px] text-dim hover:text-bad" onClick={() => act.run(async () => { await requestJson(`/policies/${p.policy_id}`, { method: "DELETE" }); list.reload(); })}>remove</button></div>
              <div className="mono text-[11px] text-dim">{JSON.stringify(p.rule)} · {short(p.policy_sha256)}</div>
            </div>
          ))}
        </Section>
        <Section title="Last evaluation">
          {!evaluation ? <p className="text-[13px] text-dim">Evaluate the current team and its first mission against every enabled policy.</p> : <>
            <div className="mb-2"><Status v={evaluation.allowed ? "PASS" : "FAILED"} label={evaluation.allowed ? "allowed" : "blocked"} /></div>
            {evaluation.decisions.length === 0 && <p className="text-[13px] text-dim">No enabled policy: allowed.</p>}
            {evaluation.decisions.map((d) => <div key={d.policy_id} className="flex items-center justify-between gap-3 py-1"><span className="text-[12px]"><Mono>{d.policy_id}</Mono> · <span className="text-dim">{d.reason}</span></span><Status v={d.ok ? "PASS" : "FAILED"} /></div>)}
            <div className="mono mt-2 text-[11px] text-dim">evaluation_sha256 {short(evaluation.evaluation_sha256)}</div>
          </>}
        </Section>
      </div>
    </Page>
  );
}

// ── Organizations ────────────────────────────────────────────────────────────────────────────────────
export function Organizations() {
  const list = useLoad<Org[]>("/organizations");
  const act = useAction();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  return (
    <Page eyebrow="CONTROL · ORGANIZATIONS" title="Organizations" lead="Registered organizations plus every organization and project the API has seen in teams, missions and runs.">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act.run(async () => { await requestJson("/organizations", { method: "POST", body: JSON.stringify({ organization_id: id, name }) }); setId(""); setName(""); list.reload(); }); }}>
        <label className="sr-only" htmlFor="org-id">Organization id</label>
        <input id="org-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="organization_id" className="focus-ring glass mono rounded-md px-3 py-2 text-[12px]" />
        <label className="sr-only" htmlFor="org-name">Name</label>
        <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="focus-ring glass rounded-md px-3 py-2 text-[13px]" />
        <button type="submit" disabled={act.busy || !id || !name} className="focus-ring tap rounded-md border border-cyan/40 bg-cyan/10 px-3 text-[12px] text-cyan disabled:opacity-40">Register</button>
      </form>
      <Err msg={act.error || list.error} />
      <Section title={`Organizations · ${list.data?.length ?? 0}`}>
        {list.data?.length === 0 && <p className="text-[13px] text-dim">None yet in this API process. Run a mission or register one.</p>}
        {list.data?.map((o) => <Kv key={o.organization_id} k={`${o.organization_id} · ${o.source}`}>{o.name}{o.projects.length ? ` · ${o.projects.join(", ")}` : ""}</Kv>)}
      </Section>
    </Page>
  );
}

// ── Secrets ──────────────────────────────────────────────────────────────────────────────────────────
export function Secrets() {
  const list = useLoad<Secret[]>("/secrets");
  return (
    <Page eyebrow="CONTROL · SECRETS" title="Secrets" lead="Secrets live in the deployment's environment variables. This page shows only their names and whether they are set: never a value, a length, a prefix or a hash.">
      <Err msg={list.error} />
      <Section title="Environment">
        {list.data?.map((s) => <div key={s.name} className="flex items-center justify-between gap-3 py-1.5"><span className="text-[12px]"><Mono>{s.name}</Mono> · <span className="text-dim">{s.used_by}</span></span><Status v={s.set ? "PASS" : "UNKNOWN"} label={s.set ? "set" : "not set"} /></div>)}
      </Section>
    </Page>
  );
}

// ── Permissions ──────────────────────────────────────────────────────────────────────────────────────
export function PermissionsView() {
  const p = useLoad<Permissions>("/permissions");
  return (
    <Page eyebrow="CONTROL · PERMISSIONS" title="Permissions" lead="What the API enforces today, route by route. A test calls every 'session' route without a token and expects 401, so this table cannot drift from the code.">
      <Err msg={p.error} />
      {p.data && <>
        <div className="flex flex-wrap gap-6 text-[13px]"><span>Auth mode <Mono>{p.data.auth_mode}</Mono></span><span>Identity <Mono>{p.data.identity ? `${p.data.identity.identity_id} · ${p.data.identity.roles.join(", ")}` : "none (no session)"}</Mono></span></div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-panel text-dim"><tr><th className="px-3 py-2">Permission</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Enforced</th></tr></thead>
            <tbody>{p.data.permissions.map((r) => <tr key={r.permission} className="border-t border-line"><td className="mono px-3 py-1.5">{r.permission}</td><td className="mono px-3 py-1.5 text-dim">{r.method} {r.path}</td><td className="px-3 py-1.5"><Status v={r.enforced === "session" ? "PASS" : "UNKNOWN"} label={r.enforced} /></td></tr>)}</tbody>
          </table>
        </div>
      </>}
    </Page>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────────────────────────────
export function Notifications() {
  const { data } = useOsa();
  const intel = useLoad<{ id: string; label: string; status: string; version: string | null; proofs: { ok: boolean; proof_id: string }[] }[]>("/intelligence");
  const deps = useLoad<Deployment[]>("/deployments");
  const items: { level: string; text: string }[] = [];
  for (const r of data.runs) if (r.verdict !== "VERIFIED") items.push({ level: "FAILED", text: `Run ${r.proof.mission_id} ended ${r.verdict}${r.proof.runtime_failure ? `: ${r.proof.runtime_failure}` : ""}` });
  for (const m of intel.data ?? []) if (m.version && m.status !== "LIVE") items.push({ level: "INCOMPLETE", text: `${m.label} is ${m.status}: failing proofs ${m.proofs.filter((p) => !p.ok).map((p) => p.proof_id).join(", ")}` });
  for (const d of deps.data ?? []) if (d.status === "ROLLED_BACK") items.push({ level: "INCOMPLETE", text: `Deployment ${short(d.deployment_id)} (${d.team_id} v${d.team_version}, ${d.environment}) was rolled back` });
  return (
    <Page eyebrow="SYSTEM · NOTIFICATIONS" title="Notifications" lead="Things that need attention, derived when this page opens from runs, Intelligence reports and deployments. Nothing is stored or pushed yet.">
      <Err msg={intel.error || deps.error} />
      {items.length === 0 ? <p className="text-[14px] text-dim">Nothing needs attention: every run verified, every implemented module is LIVE, no rollbacks.</p> :
        <ul className="space-y-2">{items.map((n, i) => <li key={i} className="flex items-start gap-3 rounded-md border border-line bg-panel px-3 py-2 text-[13px]"><Status v={n.level} label={n.level === "FAILED" ? "alert" : "notice"} /><span>{n.text}</span></li>)}</ul>}
    </Page>
  );
}


// ── Experiments ──────────────────────────────────────────────────────────────────────────────────────
interface ExperimentRow { experiment_id: string; name: string; dataset_id: string; dataset_version: number; team_version: string; summary: { examples: number; verified: number; mean_scores: Record<string, number> }; outcome_sha256: string }
interface Comparison { same_outcome: boolean; verified_delta: number; mean_score_deltas: Record<string, number>; changed: { example_id: string; verdict: { a: string; b: string } | null; score_deltas: Record<string, number> }[] }
const tolerate409 = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (!(e instanceof Error) || !/already exists|changes nothing/.test(e.message)) throw e; } };

export function Experiments() {
  const { data } = useOsa();
  const report = useLoad<{ status: string; proofs: { proof_id: string; ok: boolean; detail: string }[] }>("/intelligence/experiments");
  const list = useLoad<ExperimentRow[]>("/experiments");
  const act = useAction();
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const post = (path: string, body: unknown) => requestJson(path, { method: "POST", body: JSON.stringify(body) });
  const prepare = () => act.run(async () => {
    await post("/teams", data.team);
    const examples = data.missions.map((m) => ({ example_id: m.mission_id.replace(/[^A-Za-z0-9_.-]/g, "_"), objective: m.objective, input: m.input, requirements: m.requirements, expected: { verdict: "VERIFIED" } }));
    await tolerate409(post("/datasets", { dataset_id: "dashboard-missions", name: "Dashboard missions", examples }));
    await tolerate409(post("/evaluators", { evaluator_id: "verdict", spec: { type: "verdict_match" } }));
    await tolerate409(post("/evaluators", { evaluator_id: "receipt", spec: { type: "receipt_valid" } }));
  });
  const runExp = () => act.run(async () => {
    await post("/experiments", { dataset_id: "dashboard-missions", team_id: data.team.team_id, version: data.team.version, evaluator_ids: ["verdict", "receipt"] });
    list.reload();
  });
  const compareLatest = () => act.run(async () => {
    const rows = list.data ?? [];
    if (rows.length < 2) throw new Error("run at least two experiments to compare");
    setCmp(await requestJson<Comparison>(`/experiments/compare?a=${rows[1].experiment_id}&b=${rows[0].experiment_id}`));
  });
  return (
    <Page eyebrow="INTELLIGENCE · EXPERIMENTS" title="Experiments" lead="Run every example of a pinned dataset version against one Team Graph version, score each run with evaluators, and seal the outcome. Compare two experiments to see which examples regressed.">
      {report.data && <div className="flex flex-wrap items-center gap-3 text-[13px]"><Status v={report.data.status} framed />{report.data.proofs.map((p) => <span key={p.proof_id} className="text-dim"><Mono>{p.proof_id}</Mono> {p.ok ? "✓" : "✗"}</span>)}</div>}
      <div className="flex flex-wrap gap-2">
        <Btn onClick={prepare} disabled={act.busy}>1 · Prepare dataset + evaluators from dashboard missions</Btn>
        <Btn onClick={runExp} disabled={act.busy}>2 · Run experiment on {data.team.team_id} v{data.team.version}</Btn>
        <Btn onClick={compareLatest} disabled={act.busy}>3 · Compare the latest two</Btn>
      </div>
      <Err msg={act.error || list.error} />
      {cmp && <Section title="Comparison (older → newer)">
        <div className="text-[13px]">{cmp.same_outcome ? "Same outcome on every example." : `${cmp.changed.length} example(s) changed · verified Δ ${cmp.verified_delta}`}</div>
        {Object.entries(cmp.mean_score_deltas).map(([k, v]) => <Kv key={k} k={`mean ${k} Δ`}>{v}</Kv>)}
        {cmp.changed.map((c) => <div key={c.example_id} className="mono text-[12px] text-dim">{c.example_id}: {c.verdict ? `${c.verdict.a} → ${c.verdict.b}` : "same verdict"} {JSON.stringify(c.score_deltas)}</div>)}
      </Section>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-panel text-dim"><tr><th className="px-3 py-2">Experiment</th><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Verified</th><th className="px-3 py-2">Mean scores</th><th className="px-3 py-2">outcome_sha256</th></tr></thead>
          <tbody>
            {list.data?.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-dim">No experiments in this API process yet. Use steps 1 and 2 above.</td></tr>}
            {list.data?.map((e) => (
              <tr key={e.experiment_id} className="border-t border-line">
                <td className="mono px-3 py-2">{short(e.experiment_id)}</td><td className="mono px-3 py-2">{e.dataset_id}@v{e.dataset_version}</td><td className="mono px-3 py-2">v{e.team_version}</td>
                <td className="px-3 py-2">{e.summary.verified}/{e.summary.examples}</td>
                <td className="mono px-3 py-2">{Object.entries(e.summary.mean_scores).map(([k, v]) => `${k} ${v}`).join(" · ")}</td>
                <td className="mono px-3 py-2">{short(e.outcome_sha256)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

// ── Queues and Scheduler ─────────────────────────────────────────────────────────────────────────────
interface Job { job_id: string; mission_id: string; deployment_id: string | null; run_at: string; status: string; run_id: string | null; verdict: string | null; error: string | null }

function JobsTable({ jobs, onCancel }: { jobs: Job[]; onCancel: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-[12px]">
        <thead className="bg-panel text-dim"><tr><th className="px-3 py-2">Job</th><th className="px-3 py-2">Mission</th><th className="px-3 py-2">Run at (UTC)</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Result</th><th className="px-3 py-2" /></tr></thead>
        <tbody>
          {jobs.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-dim">No jobs.</td></tr>}
          {jobs.map((j) => (
            <tr key={j.job_id} className="border-t border-line">
              <td className="mono px-3 py-2">{short(j.job_id)}</td>
              <td className="mono px-3 py-2">{j.mission_id}{j.deployment_id ? ` · ${short(j.deployment_id)}` : ""}</td>
              <td className="mono px-3 py-2">{j.run_at.replace("T", " ").slice(0, 19)}</td>
              <td className="px-3 py-2"><Status v={j.status === "DONE" ? "PASS" : j.status === "FAILED" ? "FAILED" : "UNKNOWN"} label={j.status} /></td>
              <td className="mono px-3 py-2 text-dim">{j.verdict ? `${j.verdict} · ${short(j.run_id ?? "")}` : j.error ?? ""}</td>
              <td className="px-3 py-2">{j.status === "QUEUED" && <button className="focus-ring text-[11px] text-dim hover:text-bad" onClick={() => onCancel(j.job_id)}>cancel</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useQueue() {
  const { data } = useOsa();
  const list = useLoad<Job[]>("/queue");
  const act = useAction();
  const post = (path: string, body: unknown) => requestJson(path, { method: "POST", body: JSON.stringify(body) });
  const seed = async () => { await post("/teams", data.team); for (const m of data.missions) await post("/missions", m); };
  const enqueue = (missionId: string, runAt?: string) => act.run(async () => { await seed(); await post("/queue", { mission_id: missionId, run_at: runAt }); list.reload(); });
  const drain = () => act.run(async () => { await post("/queue/drain", {}); list.reload(); });
  const cancel = (id: string) => act.run(async () => { await requestJson(`/queue/${id}`, { method: "DELETE" }); list.reload(); });
  return { data, list, act, enqueue, drain, cancel };
}

export function Queues() {
  const q = useQueue();
  return (
    <Page eyebrow="RUNTIME · QUEUES" title="Queues" lead="Missions waiting to run. A serverless API has no background worker, so due jobs run when the queue is drained (a cron can call POST /queue/drain). Each finished job points at its run and sealed receipt.">
      <div className="flex flex-wrap gap-2">
        {q.data.missions.map((m) => <Btn key={m.mission_id} disabled={q.act.busy} onClick={() => q.enqueue(m.mission_id)}>Queue {m.mission_id} now</Btn>)}
        <Btn disabled={q.act.busy} onClick={q.drain}>Drain due jobs</Btn>
      </div>
      <Err msg={q.act.error || q.list.error} />
      <JobsTable jobs={q.list.data ?? []} onCancel={q.cancel} />
    </Page>
  );
}

export function Scheduler() {
  const q = useQueue();
  const [mission, setMission] = useState(q.data.missions[0]?.mission_id ?? "");
  const [at, setAt] = useState("");
  const future = (q.list.data ?? []).filter((j) => j.status === "QUEUED" && new Date(j.run_at).getTime() > Date.now());
  return (
    <Page eyebrow="RUNTIME · SCHEDULER" title="Scheduler" lead="Schedule a mission for a later time. It waits in the queue until run_at has passed and the queue is drained.">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); q.enqueue(mission, new Date(at).toISOString()); }}>
        <label className="sr-only" htmlFor="sch-mission">Mission</label>
        <select id="sch-mission" value={mission} onChange={(e) => setMission(e.target.value)} className="focus-ring glass rounded-md px-3 py-2 text-[13px]">{q.data.missions.map((m) => <option key={m.mission_id} value={m.mission_id}>{m.mission_id}</option>)}</select>
        <label className="sr-only" htmlFor="sch-at">Run at</label>
        <input id="sch-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="focus-ring glass rounded-md px-3 py-2 text-[13px]" />
        <button type="submit" disabled={q.act.busy || !at || !mission} className="focus-ring tap rounded-md border border-cyan/40 bg-cyan/10 px-3 text-[12px] text-cyan disabled:opacity-40">Schedule</button>
      </form>
      <Err msg={q.act.error || q.list.error} />
      <Section title={`Scheduled for later · ${future.length}`}><JobsTable jobs={future} onCancel={q.cancel} /></Section>
    </Page>
  );
}


// ── Knowledge ────────────────────────────────────────────────────────────────────────────────────────
interface Hit { doc_id: string; title: string; source: string; chunk_index: number; text: string; chunk_sha256: string; document_sha256: string; score: number }
interface Retrieval { collection: string; query: string; hits: Hit[]; retrieval_sha256: string }

export function Knowledge() {
  const list = useLoad<{ collection: string; documents: number; chunks: number }[]>("/knowledge");
  const act = useAction();
  const [collection, setCollection] = useState("docs");
  const [docId, setDocId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Retrieval | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const add = () => act.run(async () => {
    await requestJson(`/knowledge/${encodeURIComponent(collection)}/documents`, { method: "POST", body: JSON.stringify({ doc_id: docId, title, text }) });
    setDocId(""); setTitle(""); setText(""); list.reload();
  });
  const search = () => act.run(async () => {
    const r = await requestJson<Retrieval>(`/knowledge/${encodeURIComponent(collection)}/search`, { method: "POST", body: JSON.stringify({ query, k: 5 }) });
    setResult(r);
    // Re-check each quoted chunk in this browser: sha256(text) must equal the chunk_sha256 the source commits to.
    const entries = await Promise.all(r.hits.map(async (h) => [`${h.doc_id}:${h.chunk_index}`, (await sha256(h.text)) === h.chunk_sha256] as const));
    setChecks(Object.fromEntries(entries));
  });
  return (
    <Page eyebrow="INTELLIGENCE · KNOWLEDGE" title="Knowledge" lead="Retrieval over your sources where every hit cites a content-addressed chunk. Search is lexical BM25: deterministic, no model, so the same query gives the same sealed retrieval.">
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Add a document">
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="kn-col">Collection</label>
              <input id="kn-col" value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="collection" className="focus-ring glass mono w-32 rounded-md px-3 py-2 text-[12px]" />
              <label className="sr-only" htmlFor="kn-id">Document id</label>
              <input id="kn-id" value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="doc_id" className="focus-ring glass mono w-40 rounded-md px-3 py-2 text-[12px]" />
              <label className="sr-only" htmlFor="kn-title">Title</label>
              <input id="kn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="focus-ring glass min-w-0 flex-1 rounded-md px-3 py-2 text-[13px]" />
            </div>
            <label className="sr-only" htmlFor="kn-text">Text</label>
            <textarea id="kn-text" value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Paste the source text. Blank lines split it into chunks." className="focus-ring glass rounded-md px-3 py-2 text-[13px]" />
            <button type="submit" disabled={act.busy || !docId || !text.trim()} className="focus-ring tap self-start rounded-md border border-cyan/40 bg-cyan/10 px-3 text-[12px] text-cyan disabled:opacity-40">Add document</button>
          </form>
        </Section>
        <Section title={`Collections · ${list.data?.length ?? 0}`}>
          {list.data?.length === 0 && <p className="text-[13px] text-dim">No documents in this API process yet.</p>}
          {list.data?.map((c) => <Kv key={c.collection} k={c.collection}>{c.documents} documents · {c.chunks} chunks</Kv>)}
        </Section>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <label className="sr-only" htmlFor="kn-q">Query</label>
        <input id="kn-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${collection}`} className="focus-ring glass min-w-0 flex-1 rounded-md px-3 py-2 text-[13px]" />
        <button type="submit" disabled={act.busy || !query.trim()} className="focus-ring tap rounded-md border border-cyan/40 bg-cyan/10 px-3 text-[12px] text-cyan disabled:opacity-40">Search</button>
      </form>
      <Err msg={act.error || list.error} />
      {result && <Section title={`${result.hits.length} hit(s) · retrieval_sha256 ${short(result.retrieval_sha256)}`}>
        {result.hits.length === 0 && <p className="text-[13px] text-dim">No chunk matches. Nothing is invented.</p>}
        {result.hits.map((h) => {
          const ok = checks[`${h.doc_id}:${h.chunk_index}`];
          return (
            <div key={`${h.doc_id}:${h.chunk_index}`} className="border-b border-line py-2 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px]"><Mono>{h.doc_id}#{h.chunk_index}</Mono> · {h.title}{h.source ? <span className="text-dim"> · {h.source}</span> : null}</span>
                <span className="flex items-center gap-3"><Mono className="text-[11px] text-dim">score {h.score}</Mono>{ok !== undefined && <Status v={ok ? "MATCH" : "MISMATCH"} label={ok ? "citation verified" : "citation mismatch"} />}</span></div>
              <p className="mt-1 text-[13px] text-dim">{h.text}</p>
              <div className="mono text-[11px] text-dim">chunk_sha256 {short(h.chunk_sha256)} · document_sha256 {short(h.document_sha256)}</div>
            </div>
          );
        })}
      </Section>}
    </Page>
  );
}

export const CONTROL_VIEWS: Record<string, ComponentType> = {
  deployments: Deployments, experiments: Experiments, knowledge: Knowledge, queues: Queues, scheduler: Scheduler, policies: Policies, organizations: Organizations, secrets: Secrets, permissions: PermissionsView, notifications: Notifications,
};
