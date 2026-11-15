import { useCallback, useEffect, useState } from "react";
import raw from "./snapshot.json";
import type { Snapshot, Source, Run, TeamGraph, LayerProfile, Mission } from "./types";

export const snapshot = raw as unknown as Snapshot;
const emptyTeam: TeamGraph = { organization_id:"UNKNOWN", project_id:"UNKNOWN", team_id:"UNKNOWN", version:"UNKNOWN", agents:[], edges:[] };
// Keep bundled snapshot for explicit fixtures, never seed it into a user's mission view.
const emptyData: Snapshot = { ...snapshot, layers:[], team:emptyTeam, teams:[], missions:[], runs:[] };
type MissionRecordView = { mission: Mission; team: TeamGraph; state: string; run?: Run };

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
  const [data, setData] = useState<Snapshot>(emptyData);
  const [source, setSource] = useState<Source>({ kind: "UNKNOWN", detail: "Sprawdzanie danych misji" });
  const [checking, setChecking] = useState(true);
  const [runningMission, setRunningMission] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
      const [layers, records] = await Promise.all([getJson<LayerProfile[]>("/layers"), getJson<MissionRecordView[]>("/missions")]);
      if (!alive) return;
      if (!Array.isArray(records)) {
        // A failed or unauthorized read must not leave another session's mission data visible.
        setData({ ...emptyData, layers:Array.isArray(layers)?layers:[] });
        setSource({kind:"OFFLINE",detail:"Nie można odczytać misji z API; stan misji UNKNOWN"});
        setChecking(false); return;
      }
      const valid = records.filter(record => record?.mission && record?.team);
      const teams = valid.map(record => record.team);
      setData({ ...emptyData, layers:Array.isArray(layers)?layers:[], team:teams[0]??emptyTeam, teams,
        missions:valid.map(record=>record.mission), missionStates:Object.fromEntries(valid.map(record=>[record.mission.mission_id,record.state])), runs:valid.flatMap(record=>record.run?[record.run]:[]) });
      setSource({kind:"LIVE",detail:`Odczyt MissionStore · ${valid.length} misji`});
      setChecking(false);
      } finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const runMission = useCallback(async (missionId: string): Promise<Run> => {
    const mission = data.missions.find((item) => item.mission_id === missionId);
    if (!mission) throw new Error(`mission not found in dashboard data: ${missionId}`);
    setRunningMission(missionId);
    setActionError(null);
    try {
      const run = await requestJson<Run>(`/missions/${encodeURIComponent(missionId)}/run`, { method: "POST", body: "{}" });
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
  }, [data.missions]);

  const enterLayer = useCallback(async (layerId: string): Promise<LayerEnterResult> => {
    setActionError(null);
    try {
      const result = await requestJson<LayerEnterResult>(`/layers/${encodeURIComponent(layerId)}/enter`, { method: "POST", body: "{}" });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      throw error;
    }
  }, []);

  const inspectExecution = useCallback((team: TeamGraph, mission: Mission, run: Run) => {
    // A scoped projection of the exact API result, not a second execution or invented world state.
    setData(current => ({...current,team,teams:[team],missions:[mission],runs:[run]}));
    setSource({kind:"LIVE",detail:`${mission.mission_id.startsWith("unified_") ? "OSA Unified" : mission.mission_id.startsWith("osa-trace-") ? "OSA TRACE" : mission.mission_id.startsWith("build_") ? "Studio" : "Delivery Lab"} execution ${run.execution_id}`});
  }, []);
  return { data, source, checking, runningMission, actionError, runMission, enterLayer, inspectExecution };
}
