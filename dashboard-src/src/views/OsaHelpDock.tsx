import { useEffect, useMemo, useRef, useState } from "react";
import { useOsa, type ViewId } from "../ctx";
import { HOME_ITEM, NAV } from "../nav";

type Message={role:"user"|"assistant";text:string;model?:string;memoryUnavailable?:boolean;sourceCount?:number};
type Answer={status:string;text?:string;model?:string;provider_model?:string;memory_status?:"UNAVAILABLE";memory_context?:{references?:unknown[]}};
type ModelStatus={configured:boolean;provider?:string;model?:string};
const nav=[HOME_ITEM,...NAV.flatMap(g=>g.items)];
const FALLBACK="Oprowadź mnie po tym module OSA Proof. Wyjaśnij, co tutaj działa, co jest ograniczone i od czego zacząć.";
const help:Record<string,{intro:string;questions:string[];next?:ViewId}>={
  home:{intro:"Centralny punkt startowy. OSA pomoże Ci znaleźć odpowiednie narzędzia.",questions:["Jak zacząć pracę z OSA Proof?","Pokaż drogę od agenta do zweryfikowanego dowodu."],next:"build:agents"},
  "jeverson-chat":{intro:"Czat floty agentów służy do rozmów z wybranymi profilami. Weryfikacja wykonań jest osobną funkcją.",questions:["Czym różni się rozmowa z modelem od wykonania misji?","Którego agenta wybrać do mojego zadania?"],next:"build:agents"},
  "build:agents":{intro:"Twórz role w grafie zespołu. Sam zapis agenta nie oznacza uruchomionego wykonawcy.",questions:["Jak skonfigurować nowego agenta?","Co oznaczają executor_ref i model_ref?"],next:"build:mesh"},
  "build:mesh":{intro:"Połącz agentów w kanonicznym grafie zespołu.",questions:["Jak zaplanować przekazywanie zadań między agentami?","Jakie ograniczenia ma Team Graph?"],next:"build:studio"},
  "build:studio":{intro:"Zbuduj misję: cel, zespół, wejście i kryteria odbioru.",questions:["Jak zbudować pierwszą misję od zera?","Co sprawdza Gate Zero przed uruchomieniem?"],next:"build:playground"},
  "build:playground":{intro:"Testuj dostępne wykonania i odbieraj wyniki zamiast samych deklaracji.",questions:["Jak uruchomić test bez kosztów modelu?","Gdzie znajdę dowody po teście?"],next:"proofs"},
  missions:{intro:"Lista misji i wykonań. Sukces potwierdza dopiero zweryfikowany wynik.",questions:["Jak uruchomić istniejącą misję?","Jak odróżnić wykonanie od danych testowych?"],next:"trace"},
  trace:{intro:"Zdarzenia i ścieżka wykonania pokazują, co rzeczywiście zarejestrował Runtime.",questions:["Jak odczytać śledzenie misji?","Jak znaleźć execution_id i jego dowody?"],next:"proofs"},
  proofs:{intro:"Tutaj sprawdzasz integralność dowodów i ProofReceipt.",questions:["Jak niezależnie zweryfikować ProofReceipt?","Czym różni się CLAIM od PROOF?"],next:"replay"},
  replay:{intro:"Odtwarzanie pokazuje zapisaną kolejność zdarzeń, nie wykonuje misji ponownie.",questions:["Jak odtworzyć przebieg wykonania?","Jak porównać dwa uruchomienia?"],next:"proofs"},
  world:{intro:"Zobacz powiązania w grafie wiedzy i zarejestrowane relacje.",questions:["Jak nawigować po świecie wiedzy?","Co oznaczają węzły i powiązania?"],next:"missions"},
  "ops:runtime":{intro:"Zobacz bieżące wykonawców i tryb API.",questions:["Jak sprawdzić, czy Runtime naprawdę działa?","Co oznacza tryb fixture?"],next:"missions"},
  "ops:deployments":{intro:"Wdrożenia wiążą wersję grafu z konkretnym środowiskiem.",questions:["Jak bezpiecznie przygotować Preview?","Czym różni się Preview od produkcji?"],next:"ops:runtime"},
  "ops:permissions":{intro:"Tutaj sprawdzisz reguły dostępu do tras API.",questions:["Co blokuje uruchamianie agentów?","Jak rozpoznać problem z autoryzacją?"],next:"ops:policies"},
  "web3:overview":{intro:"Moduł Web3 pracuje w trybie odczytowym.",questions:["Jak działa obserwacja sieci Solana?","Co oznacza RPC_VALIDATED?"],next:"web3:chains"},
  "nvidia:models":{intro:"Informacje o połączeniu z NVIDIA; klucze pozostają po stronie serwera.",questions:["Jak sprawdzić dostępność modelu?","Czy odpowiedź modelu oznacza zweryfikowane wykonanie?"],next:"jeverson-chat"}
};
function labelFor(view:string){return nav.find(n=>n.view===view)?.label||view.replace(/^pending:/,"");}
function topicFor(view:string){
  if(help[view])return help[view];
  if(view.startsWith("web3:"))return {intro:"Moduł Web3 — obserwacje i dane sieci, bez podpisywania transakcji.",questions:["Co oznaczają dane na tym ekranie?","Jakie są ograniczenia i gdzie sprawdzę dowody?"],next:"web3:proof" as ViewId};
  if(view.startsWith("build:"))return {intro:"Moduł budowania OSA. Konfiguracja nie oznacza ukończonego wykonania.",questions:["Jak korzystać z tego modułu?","Jaki powinien być następny krok?"],next:"build:studio" as ViewId};
  return {intro:"Zapytaj o aktualny moduł, jego możliwości i powiązania z OSA Proof.",questions:[FALLBACK,"Pokaż mi krok po kroku, co mogę tu zrobić."],next:"home" as ViewId};
}
export default function OsaHelpDock(){
  const {view,go}=useOsa();
  const [open,setOpen]=useState(false);
  const [messages,setMessages]=useState<Message[]>([]);
  const [draft,setDraft]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [connected,setConnected]=useState<boolean|null>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const abort=useRef<AbortController|null>(null);
  const conversationId=useRef<string>("");
  const input=useRef<HTMLTextAreaElement>(null);
  const guide=useMemo(()=>topicFor(view),[view]);
  const label=labelFor(view);
  const navigation=nav.find(n=>n.view===guide.next&&n.built);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"});},[messages,busy,open]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>{if(!open)return;let alive=true;fetch("/api/nvidia/status",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then((v:ModelStatus)=>{if(alive)setConnected(Boolean(v.configured));}).catch(()=>{if(alive)setConnected(false);});const k=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};document.addEventListener("keydown",k);return()=>{alive=false;document.removeEventListener("keydown",k);};},[open]);
  async function ask(inputText?:string){
    const text=(inputText??draft).trim();
    if(!text||busy)return;
    const history=messages.slice(-8).map(m=>({role:m.role,content:m.text.slice(0,1800)}));
    setMessages(prev=>[...prev,{role:"user",text}]);
    setDraft("");setError("");setBusy(true);
    const ctl=new AbortController();abort.current=ctl;
    try{
      if(!conversationId.current)conversationId.current=crypto.randomUUID();
      const timeout=setTimeout(()=>ctl.abort(),55000);
      let response:Response;
      try{response=await fetch("/api/nvidia/fleet-chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:text,agent:"guide",view,history,conversation_id:conversationId.current}),signal:ctl.signal});}
      finally{clearTimeout(timeout);}
      const data=await response.json().catch(()=>({error:"Odpowiedź serwera ma nieprawidłowy format."})) as Answer&{error?:string};
      if(!response.ok)throw Error(data.error||"Nie udało się połączyć z modelem.");
      if(data.status!=="PROVIDER_RESPONSE"||!data.text?.trim())throw Error("Model nie zwrócił odpowiedzi.");
      setMessages(prev=>[...prev,{role:"assistant",text:data.text!.trim(),model:data.provider_model||data.model,
        memoryUnavailable:data.memory_status==="UNAVAILABLE",
        ...(data.memory_context?{sourceCount:Array.isArray(data.memory_context.references)?data.memory_context.references.length:0}:{})}]);
    }catch(e){if(!ctl.signal.aborted)setError(e instanceof Error?e.message:"Błąd połączenia z modelem.");else setError("Żądanie zostało przerwane lub przekroczyło czas oczekiwania.");}
    finally{if(abort.current===ctl)abort.current=null;setBusy(false);}
  }
  return <>
    <button type="button" data-testid="osa-help-trigger" aria-label="Zapytaj OSĘ" aria-expanded={open}
      onClick={()=>{setOpen(v=>!v);setError("");}}
      className={"focus-ring fixed right-4 z-[65] flex min-h-[48px] items-center gap-2 rounded-full border border-cyan/50 bg-[#122337] px-4 py-3 text-sm font-semibold text-white shadow-[0_6px_30px_rgba(0,0,0,.5)] hover:border-cyan sm:right-6 "+(view==="jeverson-chat"?"top-[45%]":"bottom-5 sm:bottom-6")}>
      <span aria-hidden="true" className="text-lg text-cyan">✦</span> {open?"Zamknij OSĘ":"Zapytaj OSĘ"}
    </button>
    {open&&<>
      <div className="fixed inset-0 z-[66] bg-black/60 md:hidden" onClick={()=>setOpen(false)} aria-hidden="true"/>
      <section data-testid="osa-help-panel" role="dialog" aria-label="Zapytaj OSĘ — asystent frameworka"
        className="fixed inset-x-0 bottom-0 z-[67] flex h-[min(83dvh,760px)] min-h-[320px] flex-col overflow-hidden rounded-t-2xl border border-line bg-[#0b1424] shadow-[0_0_50px_rgba(0,0,0,.5)] md:inset-x-auto md:bottom-24 md:right-6 md:h-[min(75dvh,720px)] md:w-[410px] md:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-[#122139] px-4 py-3">
          <div className="min-w-0"><div className="text-[15px] font-semibold text-white">✦ Zapytaj OSĘ</div><div className="mt-1 truncate text-[11px] text-dim">Asystent i samouczek OSA Proof · {label}</div></div>
          <button type="button" aria-label="Zamknij pomoc OSA" onClick={()=>setOpen(false)} className="focus-ring rounded-lg border border-line px-3 py-1.5 text-sm text-dim">✕</button>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
          <div className="rounded-xl border border-cyan/20 bg-cyan/5 p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-cyan">Na tym ekranie · {label}</div>
            <p className="text-[12px] leading-5 text-fg">{guide.intro}</p>
            {navigation&&<button type="button" className="focus-ring mt-3 rounded-md border border-cyan/40 px-3 py-2 text-[11px] font-semibold text-cyan hover:bg-white/5" onClick={()=>{go(navigation.view);}}>Przejdź dalej: {navigation.label} →</button>}
          </div>
          {messages.length===0&&<div className="space-y-2"><div className="label">Zacznij od pytania</div>{guide.questions.map(q=><button key={q} type="button" onClick={()=>void ask(q)} disabled={busy} className="focus-ring block w-full rounded-lg border border-line p-3 text-left text-xs leading-5 text-fg hover:border-cyan/40 disabled:opacity-50">{q} <span className="text-cyan">↗</span></button>)}</div>}
          {messages.map((m,i)=><div key={i} className={"flex "+(m.role==="user"?"justify-end":"justify-start")}><div className={"max-w-[95%] whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 text-[12px] leading-5 "+(m.role==="user"?"bg-[#1b3b58] text-white":"border border-line bg-panel text-fg")}><div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-dim">{m.role==="user"?"Ty":m.model?"OSA · NVIDIA · "+m.model:"OSA · przewodnik"}</div>{m.text}{m.memoryUnavailable&&<p role="status" className="mt-2 text-xs text-warn">NeurOSA niedostępna w tej odpowiedzi.</p>}{m.sourceCount!==undefined&&<p className="mt-2 text-[10px] text-dim">Kontekst NeurOSA · źródła: {m.sourceCount}</p>}</div></div>)}
          {busy&&<p role="status" className="text-xs text-dim">OSA odpowiada…</p>}
          {error&&<p data-testid="osa-help-error" role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-2 text-xs text-bad">{error}</p>}
        </div>
        <div className="shrink-0 border-t border-line bg-[#0e192b] px-3 pb-3 pt-3">
          <div className="mb-2 flex items-center justify-between text-[10px] text-dim"><span>Aktualny kontekst: {label}</span><span>{connected===null?"Sprawdzanie NVIDIA":connected?"NVIDIA · klucz gotowy":"NVIDIA · niedostępne"}</span></div>
          <form onSubmit={e=>{e.preventDefault();void ask();}} className="flex items-end gap-2">
            <textarea ref={input} aria-label="Pytanie do OSA" placeholder="Zapytaj o ten moduł..." value={draft} rows={2} maxLength={4000} disabled={busy} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void ask();}}} className="focus-ring min-h-[56px] min-w-0 flex-1 resize-none rounded-lg border border-line bg-panel p-3 text-xs text-fg placeholder:text-dim disabled:opacity-60"/>
            <button type="submit" disabled={!draft.trim()||busy} className="focus-ring min-h-[48px] shrink-0 rounded-lg bg-cyan px-4 text-xs font-semibold text-black disabled:opacity-50">Wyślij ↑</button>
          </form>
          <p className="mt-2 text-[10px] text-dim">OSA pomaga i tłumaczy — nie wykonuje zmian ani nie tworzy dowodów za samo napisanie odpowiedzi.</p>
        </div>
      </section>
    </>}
  </>;
}
