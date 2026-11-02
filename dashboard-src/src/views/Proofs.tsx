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
  const attribution = Array.isArray(run.proof.claim_attribution)
    ? run.proof.claim_attribution as Array<{claim:string;status:string;reason_code?:string;response_sha256?:string}>
    : [];
  const gateActive = Array.isArray(run.proof.claim_attribution);
  const trustedBuild = run.proof.attribution_mode === "CONTROL_PLANE_NO_EXTERNAL_FACTS";
  const rails = [
    { k: "CLAIM", v: `${run.proof.requirement_verdicts.length} acceptance requirement(s)`, s: "" },
    { k: "MATERIAŁY", v: `${run.evidence.length} rekordów · ${run.observations.length} obserwacji weryfikatora`, s: "" },
    { k: "WERYFIKACJA", v: run.proof.requirement_verdicts.map((r) => r.verdict).join(" · "), s: run.verdict },
    { k: "PROOF", v: run.proof.proof_id.slice(0, 22) + "…", s: "" },
    { k: "POTWIERDZENIE", v: run.proof.schema, s: "" },
  ];
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6 md:px-8">
      <RunPicker />
      <header className="border-b border-line pb-5">
        <div className="label mb-2">CLAIM ≠ PROOF</div>
        <h2 className="font-display text-[clamp(18px,2.8vw,32px)] font-normal leading-[1.3]" style={{ color: run.verdict === "VERIFIED" ? "var(--ok)" : run.verdict === "FAILED" ? "var(--bad)" : "var(--warn)" }}>
          {run.verdict === "VERIFIED" ? (trustedBuild ? "BUILD ZWERYFIKOWANY · FAKTY WYŁĄCZONE" : attribution.length > 0 ? "ZGODNOŚĆ Z ZAPISANYM ŹRÓDŁEM" : "WYKONANIE ZWERYFIKOWANE · BRAK ROZPOZNANYCH FAKTÓW") : run.verdict === "FAILED" ? "WERYFIKACJA NIEUDANA" : "WYKONANIE NIEKOMPLETNE"}
        </h2>
        <p className="mt-1 text-[14px] text-dim">{run.proof.mission_id} · zespół {run.proof.team_id} v{run.proof.team_version}</p>
        {run.proof.runtime_failure && <p className="mono mt-2 text-[12px] text-bad">błąd wykonania: {run.proof.runtime_failure}</p>}
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
          {trustedBuild && <Section title="Zaufany opt-out dla czystego builda">
            <p className="text-[12px] text-warn">Attribution Gate: wyłączona kontrola faktów zewnętrznych przez host runtime. Nie traktuj wyniku jako potwierdzenia danych spoza procesu budowania.</p>
          </Section>}
          {gateActive && <Section title="Atrybucja twierdzeń — zakres v1">
            <p className="mb-2 text-[12px] text-warn">egress: {String(run.proof.egress_status ?? "NOT_ENFORCED")} · podpis: {String(run.proof.signature_status ?? "UNAVAILABLE")}</p>
            <p className="mb-2 text-[12px] text-dim">Potwierdza zgodność obsługiwanych wartości ze śladem narzędzi. Nie potwierdza braku połączeń poza bramką ani pełnej prawdziwości faktów.</p>
            {attribution.length===0 && <p className="text-[12px] text-dim">Nie wykryto twierdzeń źródłowych w ograniczonym zakresie heurystyki v1.</p>}
            {attribution.map((a,i)=><div key={i} className="border-b border-line py-1.5 text-[12px]">
              <div className="break-words">{a.claim}</div>
              <div className={a.status==="SUPPORTED"?"text-cyan":"text-bad"}>{a.status==="SUPPORTED"?"ŹRÓDŁO ZGODNE":a.reason_code??"CLAIM_UNSUPPORTED"}</div>
              {a.response_sha256 && <div className="mono break-all text-[10px] text-dim">{a.response_sha256}</div>}
            </div>)}
          </Section>}
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
            <div><div className="label">KONTROLA INTEGRALNOŚCI · W PRZEGLĄDARCE</div>
              <div className="mt-1">{err ? <span className="mono text-[12px] text-warn">{err}</span> : !checks ? <div className="skeleton h-4 w-32 rounded" /> : bad === 0 ? <Status v="PASS" label={`${checks.length}/${checks.length} MATCH`} /> : <Status v="MISMATCH" label={`${bad} MISMATCH`} />}</div></div>
            <button onClick={() => setTamper((t) => !t)} aria-pressed={tamper} className={`focus-ring tap mono rounded-md border px-3 text-[11px] ${tamper ? "border-warn/60 text-warn" : "border-line text-dim hover:text-fg"}`}>{tamper ? "Cofnij zmianę testową" : "Symuluj naruszenie"}</button>
          </div>
          {tamper && <p className="mono mb-3 rounded border border-warn/40 bg-warn/5 p-2 text-[11px] text-warn">SYMULACJA · zmieniono status pierwszego dowodu w kopii lokalnej. Dane źródłowe nie zostały naruszone.</p>}
          <ul className="divide-y divide-line rounded-lg border border-line">
            {(checks ?? []).map((c) => (
              <li key={c.id} className="px-3 py-2"><div className="flex items-center justify-between gap-3"><span className="text-[12.5px]">{c.label}</span><Status v={c.ok ? "MATCH" : "MISMATCH"} /></div>
                {!c.ok && <div className="mono mt-1 space-y-0.5 break-all text-[10.5px]"><div className="text-dim">potwierdzenie  {c.expected}</div><div className="text-bad">obliczono {c.observed}</div></div>}</li>))}
            {!checks && !err && [0, 1, 2, 3].map((i) => <li key={i} className="px-3 py-3"><div className="skeleton h-3.5 w-3/4 rounded" /></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
