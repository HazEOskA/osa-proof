import { useCallback, useEffect, useMemo, useState } from "react";
import { OsaCtx, type ViewId } from "./ctx";
import { useOsaData } from "./data/data";
import { buildGraph } from "./lib/graph";
import { BuildProvider } from "./build";
import Shell from "./views/Shell";

export default function App() {
  const { data, source, runningMission, actionError, runMission, enterLayer } = useOsaData();
  const graph = useMemo(() => buildGraph(data), [data]);
  const [view, setView] = useState<ViewId>("home");
  const [runId, setRunId] = useState(data.runs[0]?.run_id ?? "");
  const [focus, setFocus] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<"proof" | "godmode">("proof");
  useEffect(() => { document.documentElement.dataset.osaTheme = theme; }, [theme]);
  useEffect(() => {
    if (!runId && data.runs[0]?.run_id) setRunId(data.runs[0].run_id);
  }, [data.runs, runId]);

  const go = useCallback((v: ViewId, o?: { runId?: string; focus?: string }) => {
    setView(v); if (o?.runId) setRunId(o.runId); setFocus(o?.focus ?? null);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const ctx = {
    data, source, graph, view, go, runId, setRunId, focus,
    openPalette: () => setPalette(true), theme, setTheme,
    runningMission, actionError, runMission, enterLayer,
  };
  return (
    <OsaCtx.Provider value={ctx}>
      <BuildProvider><Shell palette={palette} closePalette={() => setPalette(false)} /></BuildProvider>
    </OsaCtx.Provider>
  );
}
