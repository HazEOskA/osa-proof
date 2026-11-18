import { useCallback, useEffect, useMemo, useState } from "react";
import { OsaCtx, type ViewId } from "./ctx";
import { useOsaData } from "./data/data";
import { worldRuns } from "./data/projection";
import { buildGraph, type Graph } from "./lib/graph";
import { BuildProvider } from "./build";
import Shell from "./views/Shell";
import { useThemes } from "./useThemes";

export default function App() {
  const { data: storedData, source, runningMission, actionError, runMission, enterLayer, inspectExecution } = useOsaData();
  const [view, setView] = useState<ViewId>("home");
  const [runId, setRunId] = useState(storedData.runs[0]?.run_id ?? "");
  const data = useMemo(() => {
    const run = storedData.runs.find(item => item.run_id === runId) ?? storedData.runs[0];
    const team = run && storedData.teams?.find(item => item.team_id === run.proof.team_id && item.version === run.proof.team_version && item.organization_id === run.proof.binding.organization_id && item.project_id === run.proof.binding.project_id);
    return team ? { ...storedData, team } : storedData;
  }, [storedData, runId]);
  // Home requires a real sun node for SolarWorld; only World needs run history.
  // Keep the quadratic layout out of chat and bound World to recent executions.
  const graph = useMemo<Graph>(() => view === "world"
    ? buildGraph({...data, runs:worldRuns(data.runs)})
    : view === "home" ? buildGraph({...data, runs:[]})
    : {nodes:[],edges:[],byId:new Map()}, [data,view]);
  const [focus, setFocus] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const themeSettings = useThemes();
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
    openPalette: () => setPalette(true), ...themeSettings,
    runningMission, actionError, runMission, enterLayer, inspectExecution,
  };
  return (
    <OsaCtx.Provider value={ctx}>
      <BuildProvider><Shell palette={palette} closePalette={() => setPalette(false)} /></BuildProvider>
    </OsaCtx.Provider>
  );
}
