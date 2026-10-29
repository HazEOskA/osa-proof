import { useEffect, useState } from "react";
type ProviderState = {google:boolean;github:boolean};
export type SocialAuthStatus = {providers:ProviderState;authenticated:boolean;identity:null|{display_name:string;provider:string;roles?:string[]}};
const INITIAL: SocialAuthStatus = {providers:{google:false,github:false},authenticated:false,identity:null};
function GoogleLogo() {
  return <svg width="21" height="21" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.61 24.41c0-1.36-.12-2.66-.36-3.92H24v7.43h11a9.4 9.4 0 01-4.08 6.16v5.08h6.61c3.87-3.57 6.08-8.82 6.08-14.75z"/><path fill="#34A853" d="M24 44c5.54 0 10.19-1.83 13.59-4.96l-6.61-5.08c-1.83 1.22-4.16 1.94-6.98 1.94-5.36 0-9.91-3.62-11.53-8.5H5.66v5.25A20 20 0 0024 44z"/><path fill="#FBBC05" d="M12.47 27.4a12 12 0 010-6.8v-5.25H5.66a20 20 0 000 17.3l6.81-5.25z"/><path fill="#EA4335" d="M24 12.1c3.01 0 5.71 1.04 7.83 3.08l5.87-5.87A20 20 0 005.66 15.35l6.81 5.25c1.62-4.88 6.17-8.5 11.53-8.5z"/></svg>;
}
function GithubLogo() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 00-3.51 21.63 21.63 0 00-3.47 9.53c0 1.13.12 2.17.32 3.09-1.65-.16-3.38-.47-3.38-1.43 0-.34.03-.68.11-1.01A10.82 10.82 0 0112 .9zm0 1.73a9.1 9.1 0 017.06 14.83 8.88 8.88 0 01-4.25 2.73v-2.65c0-.9-.31-1.65-.83-2.11 2.76-.3 5.66-1.36 5.66-6.12 0-1.35-.48-2.46-1.26-3.32.13-.31.55-1.57-.12-3.27 0 0-1.02-.33-3.34 1.27A11.5 11.5 0 0012 3.57c-.99 0-1.98.14-2.91.4-2.32-1.6-3.34-1.27-3.34-1.27-.67 1.7-.25 2.96-.12 3.27-.78.86-1.26 1.97-1.26 3.32 0 4.75 2.9 5.82 5.66 6.12-.53.46-.83 1.21-.83 2.11v2.65A9.39 9.39 0 012.6 11.99c0-5.17 4.23-9.36 9.4-9.36z"/></svg>;
}
export function useSocialAuthStatus() {
  const [status,setStatus] = useState<SocialAuthStatus>(INITIAL);
  const [loading,setLoading] = useState(true);
  useEffect(()=>{
    const controller = new AbortController();
    fetch("/api/auth/social/status",{signal:controller.signal,credentials:"same-origin",cache:"no-store"})
      .then(async r=>{if(!r.ok)throw Error("social status");return await r.json() as SocialAuthStatus;})
      .then(value=>{if(!controller.signal.aborted)setStatus(value);})
      .catch(()=>{})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[]);
  return {status,loading};
}
export function useOwnerGithubAuthStatus() {
  const [configured,setConfigured] = useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    fetch("/api/auth/github/status",{signal:controller.signal,credentials:"same-origin",cache:"no-store"})
      .then(async response=>response.ok ? await response.json() as {configured?:boolean} : null)
      .then(data=>{if(!controller.signal.aborted)setConfigured(data?.configured===true);})
      .catch(()=>{if(!controller.signal.aborted)setConfigured(false);});
    return ()=>controller.abort();
  },[]);
  return configured;
}
export function SocialLoginScreen({status,onClose}:{status?:SocialAuthStatus;onClose?:()=>void}) {
  const current = useSocialAuthStatus();
  const ownerGitHubConfigured = useOwnerGithubAuthStatus();
  const data = status ?? current.status;
  const login=(provider:"google"|"github")=>{
    if(!data.providers[provider])return;
    const dest=location.pathname+location.search;
    location.assign("/api/auth/social/"+provider+"/start?return_to="+encodeURIComponent(dest));
  };
  const available=data.providers.google||data.providers.github;
  const ownerLogin=()=>{
    if(!ownerGitHubConfigured)return;
    const dest=location.pathname+location.search;
    location.assign("/api/auth/github/start?return_to="+encodeURIComponent(dest));
  };
  return <div className="fixed inset-0 z-[220] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-[#050a13] px-4 py-8 text-white" role="dialog" aria-modal="true" aria-label="Zaloguj do OSA Proof">
    <div className="pointer-events-none absolute inset-0" style={{background:"radial-gradient(ellipse at 35% 14%,rgba(22,154,235,.14),transparent 60%),radial-gradient(ellipse at 75% 95%,rgba(68,36,122,.13),transparent 55%)"}}/>
    <div className="relative w-full max-w-[420px] rounded-2xl border border-white/15 bg-[#09101d]/95 px-5 py-7 shadow-2xl sm:px-8">
      {onClose&&<button type="button" onClick={onClose} className="absolute right-4 top-3 rounded p-2 text-white/70 hover:text-white focus-ring" aria-label="Zamknij logowanie">✕</button>}
      <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-2xl font-black text-cyan-300">O</div>
      <h2 className="text-2xl font-bold tracking-tight">Witaj w OSA Proof</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">Jedno konto. Twój workspace. Zaloguj się bez hasła do OSA.</p>
      <div className="mt-7 flex flex-col gap-3">
        <button type="button" onClick={()=>login("google")} disabled={!data.providers.google}
          className="focus-ring flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-white/20 bg-white px-4 text-sm font-semibold text-[#151515] transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45">
          <GoogleLogo/> Kontynuuj z Google
        </button>
        <button type="button" onClick={()=>login("github")} disabled={!data.providers.github}
          className="focus-ring flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-white/25 bg-[#17202c] px-4 text-sm font-semibold text-white transition hover:bg-[#212f40] disabled:cursor-not-allowed disabled:opacity-45">
          <GithubLogo/> Kontynuuj z GitHub
        </button>
      </div>
      {!available && ownerGitHubConfigured && <button type="button" onClick={ownerLogin}
        className="focus-ring mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/50 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">
        <GithubLogo/> Zaloguj jako właściciel przez GitHub
      </button>}
      {!available && !ownerGitHubConfigured && <p className="mt-4 text-xs leading-5 text-amber-300" role="status">
        Logowanie na tym wdrożeniu nie jest skonfigurowane. Nie ma aktywnego dostępu społecznościowego ani ścieżki właściciela.
      </p>}
      <div className="mt-7 border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
        Konto właściciela jest rozpoznawane automatycznie po zweryfikowanym identyfikatorze. Pozostali użytkownicy nie otrzymują dostępu do panelu operatora ani prywatnej NeurOSA.
      </div>
    </div>
  </div>;
}
