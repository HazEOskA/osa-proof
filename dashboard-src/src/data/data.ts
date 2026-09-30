import { useCallback, useEffect, useState } from "react";
import raw from "./snapshot.json";
import type { Snapshot, Source, Run, TeamGraph, LayerProfile, Mission } from "./types";

export const snapshot = raw as unknown as Snapshot;

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), path.endsWith("/run") ? 660000 : 10000);
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
} {
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
      const t = snapshot.team;
      const team = await getJson<TeamGraph>(`/teams/${t.team_id}?version=${t.version}`);
      const runs = await Promise.all(snapshot.runs.map(async (r) => (await getJson<Run>(`/runs/${r.run_id}`)) ?? r));
      if (!alive) return;
      setData({ ...snapshot, layers, team: team ?? snapshot.team, runs });
      setSource({ kind: "LIVE", detail: "osa-proof API reachable" });
      setChecking(false);
    })();
    return () => { alive = false; };
  }, []);

  const runMission = useCallback(async (missionId: string): Promise<Run> => {
    const mission = data.missions.find((item) => item.mission_id === missionId);
    if (!mission) throw new Error(`mission not found in dashboard data: ${missionId}`);
    setRunningMission(missionId);
    setActionError(null);
    try {
      // ApiState is intentionally in-memory today. Seed the canonical Team Graph and
      // mission before every execution so a cold serverless instance still has the
      // exact state needed for this run.
      await requestJson<TeamGraph>("/teams", { method: "POST", body: JSON.stringify(data.team) });
      await requestJson<Mission>("/missions", { method: "POST", body: JSON.stringify(mission) });
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

  return { data, source, checking, runningMission, actionError, runMission, enterLayer };
}
