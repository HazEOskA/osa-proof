import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
type Access = {required:boolean;configured:boolean;authenticated:boolean;scope?:{organization_id:string;project_id:string}|null};
export const AccessScopeContext=createContext("local");
export const useAccessScope=()=>useContext(AccessScopeContext);
export const scopedStorageKey=(key:string,scope:string)=>scope==="local"?key:`${key}:${scope}`;
export default function AccessBoundary({children}:{children:ReactNode}) {
  const [access,setAccess]=useState<Access|null>(null),[token,setToken]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;fetch("/api/auth/access",{cache:"no-store",signal:AbortSignal.timeout(10000)}).then(async r=>{
    if(!r.ok)throw Error("Brak potwierdzenia ochrony API.");return r.json() as Promise<Access>;
  }).then(v=>{if(typeof v.required!=="boolean"||typeof v.configured!=="boolean"||typeof v.authenticated!=="boolean")throw Error("Nieprawidłowy stan dostępu.");if(v.required&&v.authenticated&&(!v.scope?.organization_id||!v.scope?.project_id))throw Error("Brak zakresu dostępu.");if(alive)setAccess(v);}).catch(()=>{
    // The static local browser harness has no auth API. Never use this exception on an internet origin.
    if(alive){if(["127.0.0.1","localhost"].includes(location.hostname))setAccess({required:false,configured:false,authenticated:false});else setError("Nie można potwierdzić dostępu. Odśwież stronę.");}
  });return()=>{alive=false;};},[]);
  if(access&&(!access.required||access.authenticated)){const scope=access.required?JSON.stringify([access.scope!.organization_id,access.scope!.project_id]):"local";return <AccessScopeContext.Provider key={scope} value={scope}>{children}</AccessScopeContext.Provider>;}
  async function login(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      const response=await fetch("/api/auth/operator-login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token}),cache:"no-store",signal:AbortSignal.timeout(10000)});
      setToken("");const body=await response.json();
      if(!response.ok)throw Error(body.error||"Dostęp odrzucony.");
      location.reload();
    }catch(e){setError(e instanceof Error?e.message:"Nie udało się zalogować.");}finally{setToken("");setBusy(false);}
  }
  return <main className="flex min-h-[100dvh] items-center justify-center bg-void p-5 text-fg"><section aria-label="Dostęp operatora OSA" className="w-full max-w-md space-y-4 rounded-xl border border-line bg-panel p-6">
    <p className="text-xs tracking-widest text-cyan">OSA PROOF</p><h1 className="text-xl font-semibold">Dostęp operatora</h1>
    {!access?<p className="text-sm text-dim">Sprawdzanie dostępu…</p>:!access.configured?<p role="status" className="text-sm text-warn">Dostęp jest zablokowany. Operator musi skonfigurować bezpieczne logowanie na serwerze.</p>:<form onSubmit={e=>void login(e)} className="space-y-3">
      <label className="block text-sm" htmlFor="osa-operator-code">Kod dostępu operatora</label>
      <input id="osa-operator-code" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} maxLength={4096} required disabled={busy} className="focus-ring w-full rounded border border-line bg-void p-3"/>
      <button disabled={busy||!token.trim()} className="focus-ring min-h-[48px] w-full rounded bg-cyan p-3 text-sm font-semibold text-black disabled:opacity-40">{busy?"Logowanie…":"Otwórz OSA Proof"}</button>
      <p className="text-xs text-dim">Sesja wygasa po 30 minutach. Kod nie jest zapisywany na urządzeniu.</p>
    </form>}
    {error&&<p role="alert" className="text-sm text-warn">{error}</p>}
  </section></main>;
}
