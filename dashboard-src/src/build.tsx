import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { snapshot, requestJson } from './data/data';
import type { TeamGraph } from './data/types';
export type BuildPage = 'agents' | 'mesh' | 'workflows' | 'tools' | 'skills' | 'connections' | 'prompts' | 'studio' | 'playground';
export type ResourceKind = 'tools' | 'skills' | 'connections' | 'prompts';
export interface Resource { id: string; kind: ResourceKind; name: string; description: string; config: Record<string, unknown>; revisions: {version: number; config: Record<string, unknown>}[] }
export interface Workspace { team: TeamGraph; resources: Resource[] }
const key = 'osa.build.workspace.v1';
function initial(): Workspace { try { const raw = JSON.parse(localStorage.getItem(key) || 'null'); if (raw?.team?.agents && Array.isArray(raw.resources)) return raw; } catch {} return {team: structuredClone(snapshot.team), resources: []}; }
interface BuildState { workspace: Workspace; update: (w: Workspace) => void; save: () => Promise<void>; message: string; saving: boolean; runtimeInfo: Record<string, unknown> }
const Context = createContext<BuildState>(null!);
export function BuildProvider({children}: {children: ReactNode}) {
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, unknown>>({mode:'UNKNOWN'});
  useEffect(() => { let alive=true; requestJson<Record<string,unknown>>('/build/status').then(info=>{if(alive)setRuntimeInfo(info);}).catch(()=>{});return()=>{alive=false;}; }, []);
  const [workspace, setWorkspace] = useState(initial); const [message, setMessage] = useState('Szkic lokalny · konfiguracja nie potwierdza dostępności wykonawców'); const [saving, setSaving] = useState(false);
  const update = (w: Workspace) => { setWorkspace(w); try { localStorage.setItem(key, JSON.stringify(w)); setMessage('Szkic zapisany lokalnie'); } catch { setMessage('Szkic w pamięci · zapis lokalny niedostępny'); } };
  // Do not replace an unsaved local draft with the process-memory server copy.
  useEffect(() => { if (localStorage.getItem(key)) return; let alive = true; requestJson<Workspace>('/build/workspace').then(w => { if (alive && w.team && Array.isArray(w.resources)) { setWorkspace(w); setMessage('Konfiguracja z API · pamięć procesu'); } }).catch(() => {}); return () => { alive = false; }; }, []);
  const save = async () => { setSaving(true); try { await requestJson('/build/workspace', {method:'POST', body:JSON.stringify(workspace)}); setMessage('Zapisano w API · pamięć procesu, bez trwałej bazy danych'); } catch(e) { setMessage(`Błąd zapisu API: ${e instanceof Error ? e.message : String(e)}`); throw e; } finally { setSaving(false); } };
  return <Context.Provider value={{workspace, update, save, message, saving, runtimeInfo}}>{children}</Context.Provider>;
}
export const useBuild = () => useContext(Context);
export const BUILD_LABELS: Record<BuildPage,string> = {agents:'Agenci', mesh:'Agent Mesh', workflows:'Workflowy', tools:'Narzędzia', skills:'Skille', connections:'MCP / A2A', prompts:'Prompty', studio:'Studio', playground:'Playground'};
export function compilePrompt(text: string, variables: Record<string,unknown>): string { return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_,name:string) => { if (!(name in variables)) throw new Error(`Brak zmiennej: ${name}`); return String(variables[name]); }); }
export function validateLinear(team: TeamGraph): string[] {
  const errors:string[] = []; const ids = new Set(team.agents.map(a=>a.agent_id));
  if (!team.agents.length) errors.push('Dodaj co najmniej jednego agenta.');
  if (ids.size !== team.agents.length) errors.push('Identyfikatory agentów muszą być unikalne.');
  for (const a of team.agents) if (!a.agent_id.trim() || !a.role.trim() || !a.executor_ref.trim()) errors.push('Agent wymaga identyfikatora, roli i wykonawcy.');
  const outgoing = new Map<string,string>();
  for (const e of team.edges) { if (!ids.has(e.from_agent_id)||!ids.has(e.to_agent_id)) errors.push('Połączenie wskazuje nieznanego agenta.'); if(outgoing.has(e.from_agent_id)) errors.push('Runtime obsługuje tylko jedno wyjście z agenta.'); outgoing.set(e.from_agent_id,e.to_agent_id); }
  for(const id of ids) { const seen=new Set<string>(); let current:string|undefined=id; while(current) { if(seen.has(current)) { errors.push('Graf zawiera cykl.'); break; } seen.add(current); current=outgoing.get(current); } }
  return [...new Set(errors)];
}

export function validateResourceConfig(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Konfiguracja musi być obiektem JSON.');
  const inspect = (v: unknown): void => { if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) { if (/^(password|token|api[_-]?key|authorization|secret)$/i.test(key)) throw new Error('Użyj credential_ref zamiast sekretów.'); inspect(child); } };
  inspect(value);
}
