import { useEffect, useMemo, useState } from "react";
import { Kv, Section, Status, Unknown } from "../ui/primitives";
import RunPicker from "../ui/RunPicker";
import { useRun } from "../lib/hooks";
import { verifyRun, type Check } from "../lib/verify";
import type { Run } from "../data/types";

export default function Proofs() {
  const run = useRun();
  const [tamper, setTamper] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [err, setErr] = useState("");

  const subject: Run = useMemo(() => {
    if (!tamper) return run;
    const c = structuredClone(run);
    if (c.evidence[0]) c.evidence[0].data = { ...c.evidence[0].data, status: "tampered" };
    return c;
  }, [run, tamper]);

  useEffect(() => {
    let alive = true; setChecks(null); setErr("");
    verifyRun(subject).then((c) => alive && setChecks(c)).catch((e) => alive && setErr(String(e.message ?? e)));
    return () => { alive = false; };
  }, [subject]);
  useEffect(() => setTamper(false), [run.run_id]);

  const bad = checks?.filter((c) => !c.ok).length ?? 0;
  const rails = [
    { k: "CLAIM", v: `${run.proof.requirement_verdicts.length} acceptance requirement(s)`, s: "" },
    { k: "EVIDENCE", v: `${run.evidence.length} records · ${run.observations.length} verifier observations`, s: "" },
    { k: "VALIDATION", v: run.proof.requirement_verdicts.map((r) => r.verdict).join(" · "), s: run.verdict },
    { k: "PROOF", v: run.proof.proof_id.slice(0, 22) + "…", s: "" },
    { k: "RECEIPT", v: run.proof.schema, s: "" },
  ];
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6 md:px-8">
      <RunPicker />
      <header className="border-b border-line pb-5">
        <div className="label mb-2">CLAIM ≠ PROOF</div>
        <h2 className="font-display text-[clamp(18px,2.8vw,32px)] font-normal leading-[1.3]" style={{ color: run.verdict === "VERIFIED" ? "var(--ok)" : run.verdict === "FAILED" ? "var(--bad)" : "var(--warn)" }}>
          {run.verdict === "VERIFIED" ? "RUN VERIFIED" : run.verdict === "FAILED" ? "VERIFICATION FAILED" : "RUN INCOMPLETE"}
        </h2>
        <p className="mt-1 text-[14px] text-dim">{run.proof.mission_id} · team {run.proof.team_id} v{run.proof.team_version}</p>
        {run.proof.runtime_failure && <p className="mono mt-2 text-[12px] text-bad">runtime failure: {run.proof.runtime_failure}</p>}
      </header>

      <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
        {rails.map((r, i) => (
          <li key={r.k} className="bg-ink p-3"><span className="label">{i + 1} · {r.k}</span>{r.s && <div className="mt-1"><Status v={r.s} /></div>}<div className="mono mt-2 break-all text-[11px] text-dim">{r.v}</div></li>
        ))}
      </ol>

      <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <Section title="Requirement verdicts">
            {run.proof.requirement_verdicts.map((r) => <div key={r.requirement_id} className="py-1.5"><div className="flex items-center justify-between"><span className="mono text-[12px]">{r.requirement_id}</span><Status v={r.verdict} /></div><div className="text-[12px] text-dim">{r.reason}</div></div>)}
          </Section>
          <Section title="Receipt">
            <Kv k="proof_id">{run.proof.proof_id}</Kv><Kv k="receipt_sha256">{run.proof.receipt_sha256}</Kv><Kv k="evidence_root">{run.proof.evidence_root}</Kv>
            <Kv k="final_output_sha256">{run.proof.final_output_sha256 ?? <Unknown />}</Kv><Kv k="created_at">{run.proof.created_at}</Kv><Kv k="verifier">{run.proof.verifier.name} v{run.proof.verifier.version}</Kv><Kv k="execution_id">{run.execution_id}</Kv>
          </Section>
          <Section title="What this does and does not prove">
            <p className="text-[12.5px] leading-relaxed text-dim">Digests are plain SHA-256 over canonical JSON; anyone can recompute them. This detects inconsistent tampering and replay. It does <b className="text-fg">not</b> use signatures or an independent verifier (same process as the runtime), and artifact quality is not judged. Source: PROOF_PROTOCOL_V2.</p>
          </Section>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><div className="label">INDEPENDENT RECOMPUTATION · IN YOUR BROWSER</div>
              <div className="mt-1">{err ? <span className="mono text-[12px] text-warn">{err}</span> : !checks ? <div className="skeleton h-4 w-32 rounded" /> : bad === 0 ? <Status v="PASS" label={`${checks.length}/${checks.length} MATCH`} /> : <Status v="MISMATCH" label={`${bad} MISMATCH`} />}</div></div>
            <button onClick={() => setTamper((t) => !t)} aria-pressed={tamper} className={`focus-ring tap mono rounded-md border px-3 text-[11px] ${tamper ? "border-warn/60 text-warn" : "border-line text-dim hover:text-fg"}`}>{tamper ? "Undo tamper" : "Simulate tamper"}</button>
          </div>
          {tamper && <p className="mono mb-3 rounded border border-warn/40 bg-warn/5 p-2 text-[11px] text-warn">SIMULATION · evidence #1 status edited in a local copy. Source data untouched.</p>}
          <ul className="divide-y divide-line rounded-lg border border-line">
            {(checks ?? []).map((c) => (
              <li key={c.id} className="px-3 py-2"><div className="flex items-center justify-between gap-3"><span className="text-[12.5px]">{c.label}</span><Status v={c.ok ? "MATCH" : "MISMATCH"} /></div>
                {!c.ok && <div className="mono mt-1 space-y-0.5 break-all text-[10.5px]"><div className="text-dim">receipt  {c.expected}</div><div className="text-bad">computed {c.observed}</div></div>}</li>))}
            {!checks && !err && [0, 1, 2, 3].map((i) => <li key={i} className="px-3 py-3"><div className="skeleton h-3.5 w-3/4 rounded" /></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
