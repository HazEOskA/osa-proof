import { useEffect, useState } from "react";
import { requestJson } from "../data/data";
import { Kv, Mono, Section, Status, short } from "../ui/primitives";

// Live Intelligence module view. Everything shown comes from the API (/intelligence/:id and the module's own
// routes); status is computed by the backend from proofs, never set here.
interface ProofResult { proof_id: string; ok: boolean; detail: string }
interface ModuleReport {
  id: string; label: string; purpose: string; status: "SOON" | "PREVIEW" | "LIVE"; version: string | null;
  depends_on: string[]; blocked_by: string[]; proofs: ProofResult[]; evaluated_at: string; report_sha256: string;
}
interface DatasetSummary { dataset_id: string; version: number; example_count: number; tags: string[]; version_sha256: string; message: string }
interface EvaluatorDefinition { evaluator_id: string; kind: string; spec: { type: string }; pass_threshold: number; evaluator_sha256: string }

const API_NOTES: Record<string, string[]> = {
  models: ["GET /intelligence/models"],
  "llm-gateway": ["GET /intelligence/llm-gateway", "OSA_PROVIDER · OSA_MODEL · OSA_PROVIDER_MAX_RETRIES"],
  "model-mesh": ["GET /intelligence/model-mesh", "OSA_MODEL_FALLBACKS=provider:model,…"],
  datasets: ["POST /datasets", "GET /datasets/:id?as_of=", "POST /datasets/:id/versions", "PUT /datasets/:id/tags/:tag", "GET /datasets/:id/verify"],
  evaluators: ["POST /evaluators", "POST /runs/:id/evaluations", "POST /runs/:id/labels", "GET /runs/:id/evaluations"],
  memory: ["Lives in the separate neurosa repository."],
};

const DOC_SECTIONS = new Set(["models", "llm-gateway", "model-mesh", "datasets", "evaluators"]);

export default function Intelligence({ id }: { id: string }) {
  const [report, setReport] = useState<ModuleReport | null>(null);
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [evaluators, setEvaluators] = useState<EvaluatorDefinition[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setReport(null); setErr(""); setDatasets(null); setEvaluators(null);
    requestJson<ModuleReport>(`/intelligence/${encodeURIComponent(id)}`)
      .then((r) => alive && setReport(r))
      .catch((e: Error) => alive && setErr(e.message));
    if (id === "datasets") requestJson<DatasetSummary[]>("/datasets").then((d) => alive && setDatasets(d)).catch(() => alive && setDatasets([]));
    if (id === "evaluators") requestJson<EvaluatorDefinition[]>("/evaluators").then((d) => alive && setEvaluators(d)).catch(() => alive && setEvaluators([]));
    return () => { alive = false; };
  }, [id]);

  if (err) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-6 md:px-8">
        <div className="label mb-2">INTELLIGENCE · {id.toUpperCase()}</div>
        <p className="text-[14px] text-bad">API unreachable: {err}</p>
        <p className="mt-2 text-[13px] text-dim">This view reads GET /api/intelligence/{id}. Nothing is shown rather than something invented.</p>
      </div>
    );
  }
  if (!report) return <div className="mx-auto max-w-[900px] px-4 py-6 text-[13px] text-dim md:px-8">Loading /intelligence/{id}…</div>;

  const passed = report.proofs.filter((p) => p.ok).length;
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-6 md:px-8">
      <header className="border-b border-line pb-5">
        <div className="label mb-2">INTELLIGENCE · STATUS FROM PROOFS</div>
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="font-display text-[clamp(20px,3vw,34px)] font-normal">{report.label}</h2>
          <Status v={report.status} framed />
        </div>
        <p className="mt-1 max-w-[70ch] text-[14px] text-dim">{report.purpose}</p>
      </header>

      <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        <li className="bg-ink p-3"><span className="label">Proofs</span><div className="mono mt-2 text-[20px]">{passed}/{report.proofs.length}</div></li>
        <li className="bg-ink p-3"><span className="label">Version</span><div className="mono mt-2 text-[20px]">{report.version ?? "—"}</div></li>
        <li className="bg-ink p-3"><span className="label">Blocked by</span><div className="mono mt-2 text-[14px]">{report.blocked_by.length ? report.blocked_by.join(", ") : "nothing"}</div></li>
      </ol>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <Section title="Required proofs">
            {report.proofs.length === 0 && <p className="text-[13px] text-dim">No implementation registered, so there is nothing to prove yet.</p>}
            {report.proofs.map((p) => (
              <div key={p.proof_id} className="py-1.5">
                <div className="flex items-center justify-between gap-3"><Mono className="text-[12px]">{p.proof_id}</Mono><Status v={p.ok ? "PASS" : "FAILED"} /></div>
                <div className="text-[12px] text-dim">{p.detail}</div>
              </div>
            ))}
          </Section>
          {datasets && (
            <Section title={`Datasets in this API process · ${datasets.length}`}>
              {datasets.length === 0 && <p className="text-[13px] text-dim">None yet. Create one with POST /datasets; storage is process memory.</p>}
              {datasets.map((d) => (
                <div key={d.dataset_id} className="py-1.5">
                  <div className="flex items-center justify-between gap-3"><Mono className="text-[12px]">{d.dataset_id} · v{d.version}</Mono><span className="text-[12px] text-dim">{d.example_count} examples{d.tags.length ? ` · ${d.tags.join(", ")}` : ""}</span></div>
                  <div className="mono text-[11px] text-dim">{short(d.version_sha256)}</div>
                </div>
              ))}
            </Section>
          )}
          {evaluators && (
            <Section title={`Evaluators in this API process · ${evaluators.length}`}>
              {evaluators.length === 0 && <p className="text-[13px] text-dim">None yet. Register one with POST /evaluators; storage is process memory.</p>}
              {evaluators.map((e) => (
                <div key={e.evaluator_id} className="py-1.5">
                  <div className="flex items-center justify-between gap-3"><Mono className="text-[12px]">{e.evaluator_id}</Mono><span className="text-[12px] text-dim">{e.spec.type} · {e.kind} · pass ≥ {e.pass_threshold}</span></div>
                  <div className="mono text-[11px] text-dim">{short(e.evaluator_sha256)}</div>
                </div>
              ))}
            </Section>
          )}
        </div>
        <div>
          <Section title="Report">
            <Kv k="module">{report.id}</Kv>
            <Kv k="depends on">{report.depends_on.length ? report.depends_on.join(", ") : "—"}</Kv>
            <Kv k="evaluated_at">{report.evaluated_at}</Kv>
            <Kv k="report_sha256">{short(report.report_sha256)}</Kv>
          </Section>
          {API_NOTES[report.id] && (
            <Section title="API">
              <ul className="mono space-y-1 text-[12px] text-dim">{API_NOTES[report.id].map((n) => <li key={n}>{n}</li>)}</ul>
            </Section>
          )}
          <Section title="Docs"><a className="text-[13px] text-cyan hover:underline" href={`/docs#${DOC_SECTIONS.has(report.id) ? report.id : "intelligence"}`}>Open the {report.label} docs</a></Section>
        </div>
      </div>
    </div>
  );
}
