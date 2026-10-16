import { useCallback, useEffect, useState, useRef } from "react";
import raw from "./snapshot.json";
import { verifyRun } from "../lib/verify";
import { scopedStorageKey, useAccessScope } from "../AccessBoundary";
import type { Snapshot, Source, Run, TeamGraph, LayerProfile, Mission } from "./types";

export const snapshot = raw as unknown as Snapshot;

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), (path.endsWith("/run") || path === "/templates/delivery-lab/runs") ? 660000 : 10000);
  try {
    const res = await fetch(`/api${path}`, {
      ...init,
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = await res.text();
    let parsed: unknown = null;
    try { parsed = body ? JSON.parse(body) : null; } catch { /* handled below */ }
    if (!res.ok) {
      const message = parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
      throw new Error(message);
    }
    if (parsed === null) throw new Error(`empty or non-JSON response from ${path}`);
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  try { return await requestJson<T>(path); } catch { return null; }
}

export interface LayerEnterResult {
  decision: "ALLOWED" | "GATED";
  layer: LayerProfile;
  gate?: { code: string; requirements: string[]; authoritative: boolean };
}

export function useOsaData(): {
  data: Snapshot;
  source: Source;
  checking: boolean;
  runningMission: string | null;
  actionError: string | null;
  runMission: (missionId: string) => Promise<Run>;
  enterLayer: (layerId: string) => Promise<LayerEnterResult>;
  inspectExecution: (team: TeamGraph, mission: Mission, run: Run) => void;
} {
  const storageKey=scopedStorageKey("osa.execution.bundle.v1",useAccessScope());
  const liveExecution = useRef(false);
  const [data, setData] = useState<Snapshot>(snapshot);
  const [source, setSource] = useState<Source>({ kind: "SNAPSHOT", detail: `captured ${snapshot.captured_at.slice(0, 16).replace("T", " ")}Z · ${snapshot.source.mode} mode` });
  const [checking, setChecking] = useState(true);
  const [runningMission, setRunningMission] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const layers = await getJson<LayerProfile[]>("/layers");
      if (!alive) return;
      if (!Array.isArray(layers)) { setChecking(false); return; }
      try {
        const raw=localStorage.getItem(storageKey);
        if(raw && raw.length<=512000){
          const saved=JSON.parse(raw) as {team:TeamGraph;mission:Mission;run:Run};
          const checks=await verifyRun(saved.run);
          const remote=await requestJson<{ok:boolean}>("/unified/verify",{method:"POST",body:JSON.stringify(saved)});
          if(!checks.length||!checks.every(c=>c.ok)||!remote.ok)throw Error("INVALID_LOCAL_PROOF");
          if(!alive)return;
          liveExecution.current=true;
          setData({...snapshot,layers,team:saved.team,missions:[saved.mission],runs:[saved.run]});
          setSource({kind:"SNAPSHOT",detail:"Zweryfikowany zapis lokalny · "+saved.run.execution_id+" · bez gwarancji zapisu w chmurze"});
          setChecking(false);return;
        }
      } catch { if(alive)setActionError("Zapisany lokalnie dowód nie przeszedł weryfikacji lub API jest niedostępne."); }
      const t = snapshot.team;
      const team = await getJson<TeamGraph>(`/teams/${t.team_id}?version=${t.version}`);
      const retrieved = await Promise.all(snapshot.runs.map(r => getJson<Run>(`/runs/${r.run_id}`)));
      const runs = retrieved.map((run,index)=>run ?? snapshot.runs[index]);
      if (!alive) return;
      if (liveExecution.current) { setData(current=>({...current,layers}));setChecking(false);return; }
      setData({ ...snapshot, layers, team: team ?? snapshot.team, runs });
      const allLive = retrieved.every(Boolean);
      setSource({kind:allLive?"LIVE":"SNAPSHOT",detail:allLive?"osa-proof API reachable":"API online · zapisany snapshot fixture; brak nowego wykonania"});
      setChecking(false);
    })();
    return () => { alive = false; };
  }, [storageKey]);

  const runMission = useCallback(async (missionId: string): Promise<Run> => {
    const mission = data.missions.find((item) => item.mission_id === missionId);
    if (!mission) throw new Error(`mission not found in dashboard data: ${missionId}`);
    setRunningMission(missionId);
    setActionError(null);
    try {
      // ApiState is intentionally in-memory today. Seed the canonical Team Graph and
      // mission before every execution so a cold serverless instance still has the
      // exact state needed for this run.
      if (!data.team.agents.some(agent => agent.executor_ref.startsWith("demo."))) {
      await requestJson<TeamGraph>("/teams", { method: "POST", body: JSON.stringify(data.team) });
      await requestJson<Mission>("/missions", { method: "POST", body: JSON.stringify(mission) });
      }
      const run = await requestJson<Run>(`/missions/${encodeURIComponent(missionId)}/run`, { method: "POST", body: "{}" });
      liveExecution.current = true;
      setData((current) => ({
        ...current,
        runs: [run, ...current.runs.filter((item) => item.run_id !== run.run_id)],
      }));
      setSource({ kind: "LIVE", detail: `live execution ${run.execution_id}` });
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      throw error;
    } finally {
      setRunningMission(null);
    }
  }, [data.missions, data.team]);

  const enterLayer = useCallback(async (layerId: string): Promise<LayerEnterResult> => {
    setActionError(null);
    try {
      const result = await requestJson<LayerEnterResult>(`/layers/${encodeURIComponent(layerId)}/enter`, { method: "POST", body: "{}" });
      setSource({ kind: "LIVE", detail: `${result.layer.label} access: ${result.decision}` });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      throw error;
    }
  }, []);

  const inspectExecution = useCallback((team: TeamGraph, mission: Mission, run: Run) => {
    liveExecution.current = true;
    try {const raw=JSON.stringify({team,mission,run});if(raw.length<=512000)localStorage.setItem(storageKey,raw);}catch{/* Local export is optional and never cloud persistence. */}
    // A scoped projection of the exact API result, not a second execution or invented world state.
    setData(current => ({...current,team,missions:[mission],runs:[run]}));
    setSource({kind:"LIVE",detail:`${mission.mission_id.startsWith("unified_") ? "OSA Unified" : mission.mission_id.startsWith("osa-trace-") ? "OSA TRACE" : "Delivery Lab"} execution ${run.execution_id}`});
  }, [storageKey]);
  return { data, source, checking, runningMission, actionError, runMission, enterLayer, inspectExecution };
}
