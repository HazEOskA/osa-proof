import { useSyncExternalStore } from "react";
import { requestJson } from "./data";
import type { Web3WorldState } from "../../../packages/contracts/src/web3";
import type { Run } from "./types";
export type Web3Page = "overview" | "chains" | "wallets" | "entities" | "events" | "transactions" | "agents" | "protocols" | "risk" | "proof";
export interface Web3Status { version: string; mode: string; rpcConfigured: boolean; signingEnabled: boolean; executionEnabled: boolean; authMode: string; organization_id: string; defaultProject: string; capabilities: { id: string; health: string }[]; agents: { role: string; executor_ref: string; status?: string }[]; protocols: { id: string; support: string }[] }
export interface Web3Mission { record: { mission: { mission_id: string; organization_id: string; project_id: string }; state: string; run?: Run; timeline: unknown[]; mission_receipt?: { receipt_sha256: string } }; world: Web3WorldState | null }
interface State { status: Web3Status | null; mission: Web3Mission | null; busy: boolean; error: string }
let state: State = { status: null, mission: null, busy: false, error: "" };
const listeners = new Set<() => void>();
function update(next: Partial<State>) { state = { ...state, ...next }; listeners.forEach(fn => fn()); }
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const useWeb3Data = () => useSyncExternalStore(subscribe,() => state);
const headers = (): Record<string,string> => { const token = sessionStorage.getItem("osa.web3.session")?.trim(); return token ? { authorization: `Bearer ${token}` } : {}; };
export function setWeb3Session(token: string) { if (token.trim()) sessionStorage.setItem("osa.web3.session",token.trim()); else sessionStorage.removeItem("osa.web3.session"); update({ mission: null, status: null, error: "" }); }
export async function refreshWeb3Status() {
  try { update({ status: await requestJson<Web3Status>("/web3/status",{ headers: headers() }),error: "" }); }
  catch (e) { update({ status: null, mission: null, error: e instanceof Error ? e.message : "API_UNAVAILABLE" }); }
}
export async function loadWeb3Mission(id: string) {
  if (state.busy) return; update({ busy: true, error: "", mission: null });
  try { update({ mission: await requestJson<Web3Mission>(`/web3/missions/${encodeURIComponent(id)}`,{ headers: headers() }) }); }
  catch (e) { update({ error: e instanceof Error ? e.message : "API_UNAVAILABLE" }); }
  finally { update({ busy: false }); }
}
export async function observeWeb3(mission_id: string, input: Record<string, unknown>) {
  if (state.busy) return; update({ busy: true, error: "", mission: null });
  try {
    await requestJson("/web3/observe",{ method: "POST",headers: headers(),body: JSON.stringify({ mission_id,input }) });
    update({ mission: await requestJson<Web3Mission>(`/web3/missions/${encodeURIComponent(mission_id)}`,{ headers: headers() }) });
  } catch (e) { update({ error: e instanceof Error ? e.message : "API_UNAVAILABLE" }); }
  finally { update({ busy: false }); }
}
