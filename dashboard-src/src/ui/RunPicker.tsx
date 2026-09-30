import { useOsa } from "../ctx";
import { Status } from "./primitives";
export default function RunPicker({ className = "" }: { className?: string }) {
  const { data, runId, setRunId } = useOsa();
  return (
    <div className={`flex flex-wrap gap-2 ${className}`} role="radiogroup" aria-label="Run">
      {data.runs.map((r) => (
        <button key={r.run_id} role="radio" aria-checked={r.run_id === runId} onClick={() => setRunId(r.run_id)}
          className={`focus-ring tap flex items-center gap-2.5 rounded-md border px-3 text-left ${r.run_id === runId ? "border-brand bg-raise shadow-[0_0_0_1px_rgb(var(--brand-rgb)),0_0_24px_rgb(var(--brand-rgb)/.35)]" : "border-line2 bg-panel hover:bg-raise"}`}>
          <span className="mono text-[12px]">{r.proof.mission_id}</span><Status v={r.verdict} />
        </button>
      ))}
    </div>
  );
}
