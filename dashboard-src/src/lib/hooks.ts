import { useEffect, useState } from "react";
import { useOsa } from "../ctx";
import type { Run } from "../data/types";
export function useNarrow(px = 768) {
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia(`(max-width:${px - 1}px)`).matches);
  useEffect(() => { const m = window.matchMedia(`(max-width:${px - 1}px)`); const f = () => setN(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [px]);
  return n;
}
export function useRun(): Run {
  const { data, runId } = useOsa();
  return data.runs.find((r) => r.run_id === runId) ?? data.runs[0];
}
