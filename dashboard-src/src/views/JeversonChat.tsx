import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useOsa } from "../ctx";
import { verifyRun } from "../lib/verify";
import type { Mission, Run, TeamGraph } from "../data/types";

// Native OSA surface. No iframe, no client secrets, no pretend model execution.
type AgentId = "leader" | "coding" | "commerce" | "hermes" | "security" | "research" | "runtime";
type ModelId = "auto" | "nvidia" | "openrouter";
type Msg = { id:string; role:"user"|"assistant"; text:string; at:string; status:"USER"|"VERIFIED"|"BLOCKED"; executionId?:string; runId?:string };
type Session = { id:string; title:string; agent:AgentId; model:ModelId; updated:string; messages:Msg[] };
type Bundle = { status:string; execution_id:string; team:TeamGraph; mission:Mission; run:Run };
type Trace = Bundle & { task_status:string; proof_verdict:string; steps:Array<{url:string;http_status:number|null;status:string}> };
type StatusInfo = { mode?:string; auth_mode?:string; persistence?:string };
const KEY = "osa.native-chat.v1";
const ACTIVE = "osa.native-chat.active.v1";
const AGENTS: Array<{id:AgentId;name:string;purpose:string;state:string;icon:string}> = [
  {id:"leader",name:"Lider",purpose:"Team Graph · delegowanie · plan",state:"OGRANICZONY",icon:"◇"},
  {id:"coding",name:"Agent programistyczny",purpose:"Kod · repo · testy · review",state:"OGRANICZONY",icon:"⌘"},
  {id:"commerce",name:"Handel internetowy",purpose:"Sklep · produkty · integracje",state:"PLANOWANY",icon:"▣"},
  {id:"hermes",name:"Hermes",purpose:"Analiza · samodoskonalenie (propozycje)",state:"TYLKO PROPOZYCJE",icon:"✦"},
  {id:"security",name:"Bezpieczeństwo",purpose:"Uprawnienia · audyt · policy",state:"OGRANICZONY",icon:"⬡"},
  {id:"research",name:"Badania",purpose:"OSINT · badania · weryfikacja",state:"OGRANICZONY",icon:"⌕"},
  {id:"runtime",name:"Wykonanie / Dowody",purpose:"Dozwolone narzędzia · tracing · replay",state:"API",icon:"◎"}
];
const id = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const empty = ():Session => ({id:id(),title:"Nowa rozmowa",agent:"leader",model:"auto",updated:stamp(),messages:[]});
function restore():Session[] {
  try {
    const value:unknown = JSON.parse(localStorage.getItem(KEY)||"null");
    if (!Array.isArray(value)) return [empty()];
    const valid:Session[] = [];
    for (const item of value.slice(0,50)) {
      if (!item || typeof item.id!=="string" || typeof item.title!=="string" || !Array.isArray(item.messages) ||
          !AGENTS.some(a=>a.id===item.agent) || !["auto","nvidia","openrouter"].includes(item.model)) continue;
      const messages:Msg[] = item.messages.filter((m:Msg)=>m && typeof m.id==="string" && typeof m.text==="string" && ["user","assistant"].includes(m.role)).slice(-100).map((m:Msg)=>({...m,text:m.text.slice(0,20000)}));
      valid.push({id:item.id,title:item.title.slice(0,100),agent:item.agent,model:item.model,updated:item.updated,messages});
    }
    return valid.length?valid:[empty()];
  } catch { return [empty()]; }
}
const command = (text:string) =>
  /^(?:oblicz|policz|wylicz)\s+sha-?256\s+(?:tekstu\s*)?:/i.test(text) ||
  /(?:status|zdrowie|health)\s+(?:workera|worker|hosta)/i.test(text) ||
  /(?:sprawdź|sprawdz|pokaż|pokaz|zbadaj|status|diagnostyka).*(?:runtime|osa proof|narzędzi|narzedzi|api)/is.test(text);
async function api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const res = await fetch("/api"+path,{method:body===undefined?"GET":"POST",signal,cache:"no-store",
    headers:{"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data:unknown;try{data=await res.json();}catch{throw Error("HTTP "+res.status+" · INVALID_JSON");}
  if(!res.ok){const err=data as {error?:string;code?:string};throw Error(err?.error||err?.code||("HTTP "+res.status));}
  return data as T;
}
const TRACE_PROMPT = "OSA-TRACE-001 — wykonaj dokładnie dwa rzeczywiste żądania HTTP GET:\nhttps://osa-proof-gx6alklct-osabarca-1680s-projects.vercel.app/api/layers\nhttps://osa-proof-gx6alklct-osabarca-1680s-projects.vercel.app/api/build/status\nPokaż kod HTTP, faktyczne kroki i evidence. Niczego nie zapisuj ani nie wdrażaj.";
export default function JeversonChat() {
  const {go,inspectExecution} = useOsa();
  const [sessions,setSessions] = useState<Session[]>(restore);
  const [activeId,setActiveId] = useState(()=>{try{return localStorage.getItem(ACTIVE)||"";}catch{return "";}});
  const [draft,setDraft] = useState("");
  const [search,setSearch] = useState("");
  const [mobileHistory,setMobileHistory] = useState(false);
  const [agentOpen,setAgentOpen] = useState(false);
  const [inspector,setInspector] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [storageProblem,setStorageProblem] = useState(false);
  const [status,setStatus] = useState<StatusInfo|null>(null);
  const [lastRun,setLastRun] = useState<{sessionId:string;run:Run;verified:boolean}|null>(null);
  const seq = useRef(0), controller = useRef<AbortController|null>(null), bottom = useRef<HTMLDivElement>(null);
  const current = sessions.find(s=>s.id===activeId)||sessions[0];
  const agent = AGENTS.find(a=>a.id===current.agent)||AGENTS[0];
  const activeRun = lastRun && lastRun.sessionId===current.id && lastRun.verified?lastRun.run:null;
  useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(sessions.slice(0,50)));localStorage.setItem(ACTIVE,current.id);}catch{setStorageProblem(true);}},[sessions,current.id]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:"end"});},[current.id,current.messages.length,busy]);
  useEffect(()=>{void api<StatusInfo>("/build/status").then(setStatus).catch(()=>setStatus(null));
    return ()=>{seq.current++;controller.current?.abort();};
  },[]);
  function cancel(){seq.current++;controller.current?.abort();controller.current=null;setBusy(false);}
  function openSession(sessionId:string){cancel();setActiveId(sessionId);setMobileHistory(false);setAgentOpen(false);setInspector(false);setError("");}
  function createChat(){const next=empty();setSessions(old=>[next,...old].slice(0,50));openSession(next.id);setDraft("");}
  function update(sessionId:string,fn:(s:Session)=>Session){setSessions(old=>old.map(s=>s.id===sessionId?fn(s):s));}
  function addMessage(sessionId:string,role:Msg["role"],text:string,msgStatus:Msg["status"],extra:Partial<Msg>={}) {
    const msg:Msg={id:id(),role,text,at:stamp(),status:msgStatus,...extra};
    update(sessionId,s=>({...s,updated:stamp(),title:s.messages.length===0&&role==="user"?text.slice(0,48):s.title,messages:[...s.messages,msg].slice(-100)}));
  }
  function selectAgent(agentId:AgentId){update(current.id,s=>({...s,agent:agentId}));setAgentOpen(false);}
  function selectModel(model:ModelId){update(current.id,s=>({...s,model}));}
  async function verify(bundle:Bundle,sessionId:string) {
    if(!bundle || bundle.execution_id!==bundle.run?.execution_id || bundle.run?.proof?.execution_id!==bundle.execution_id)throw Error("EXECUTION_BINDING_INVALID");
    const [checks,remote]=await Promise.all([verifyRun(bundle.run),api<{ok:boolean}>("/unified/verify",bundle)]);
    if(!checks.length||!checks.every(check=>check.ok)||remote.ok!==true)throw Error("PROOF_VERIFICATION_FAILED");
    inspectExecution(bundle.team,bundle.mission,bundle.run);
    setLastRun({sessionId,run:bundle.run,verified:true});
  }
  async function submit(e?:FormEvent) {
    e?.preventDefault();const text=draft.trim();if(!text||busy)return;
    const sessionId=current.id;setDraft("");setError("");addMessage(sessionId,"user",text,"USER");
    if(!command(text)){
      setError("MODEL NIEDOSTĘPNY · Model NVIDIA/OpenRouter nie ma jeszcze bezpiecznego transportu operatora. Nie wykonano wywołania. Dostępne: 'pokaż status runtime', 'status workera', 'oblicz SHA-256 tekstu: ...' lub OSA TRACE.");
      return;
    }
    const request=++seq.current,abort=new AbortController();controller.current=abort;setBusy(true);
    try {
      const bundle=await api<Bundle>("/unified/execute",{message:text,execution_id:"exec_"+id()},abort.signal);
      if(request!==seq.current)return;await verify(bundle,sessionId);
      if(request!==seq.current)return;
      const output=bundle.run.final_output as Record<string,unknown>;
      const body=output&&typeof output.sha256==="string"?"SHA-256: "+output.sha256:JSON.stringify(output,null,2).slice(0,8000);
      addMessage(sessionId,"assistant",body,bundle.status==="EXECUTED"?"VERIFIED":"BLOCKED",{executionId:bundle.execution_id,runId:bundle.run.run_id});
    } catch(e) { if(request===seq.current&&!abort.signal.aborted)setError("BLOCKED · "+(e instanceof Error?e.message:String(e))); }
    finally {if(request===seq.current){controller.current=null;setBusy(false);}}
  }
  async function trace() {
    if(busy)return;setError("");const sessionId=current.id,request=++seq.current,abort=new AbortController();controller.current=abort;setBusy(true);
    try {
      const result=await api<Trace>("/trace-probe",{task_id:"OSA-TRACE-001",prompt:TRACE_PROMPT},abort.signal);
      if(request!==seq.current)return;
      const checks=await verifyRun(result.run);
      if(result.run.execution_id!==result.execution_id||!checks.length||!checks.every(c=>c.ok))throw Error("TRACE_INTEGRITY_UNVERIFIED");
      inspectExecution(result.team,result.mission,result.run);setLastRun({sessionId,run:result.run,verified:true});
      const detail=result.steps.map(s=>"GET "+s.url+" → "+(s.http_status||"BRAK")+" · "+s.status).join("\n");
      addMessage(sessionId,"assistant","OSA TRACE · "+result.task_status+" · "+result.proof_verdict+"\n"+detail,result.task_status==="EXECUTED"?"VERIFIED":"BLOCKED",{executionId:result.execution_id,runId:result.run.run_id});
    }catch(e){if(request===seq.current&&!abort.signal.aborted)setError("TRACE BLOCKED · "+(e instanceof Error?e.message:String(e)));}
    finally{if(request===seq.current){controller.current=null;setBusy(false);}}
  }
  function key(e:KeyboardEvent<HTMLTextAreaElement>){if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void submit();}}
  return <section aria-label="Czat floty agentów" data-testid="osa-native-chat" className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-[#070b13] text-fg">
    {mobileHistory&&<button onClick={()=>setMobileHistory(false)} aria-label="Zamknij historię" className="absolute inset-0 z-30 bg-black/75 md:hidden"/>}
    <aside aria-label="Historia rozmów" className={(mobileHistory?"translate-x-0":"-translate-x-full")+" absolute inset-y-0 left-0 z-40 flex w-[min(85vw,290px)] shrink-0 flex-col border-r border-white/10 bg-[#0b111c] transition-transform md:static md:w-[238px] md:translate-x-0"}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-4"><div><div className="text-xs font-bold tracking-[.16em] text-cyan">OSA / FIRMA</div><div className="mt-1 text-[10px] text-dim">CENTRUM STEROWANIA AGENTAMI</div></div><button onClick={()=>setMobileHistory(false)} className="md:hidden" aria-label="Zamknij menu">✕</button></div>
      <button data-testid="osa-new-chat" onClick={createChat} className="focus-ring mx-3 mt-3 rounded-xl border border-cyan/50 bg-cyan/10 p-3 text-left text-sm font-semibold text-cyan">＋ Nowa rozmowa</button>
      <label className="mx-3 mt-4 block text-[10px] uppercase tracking-wider text-dim">Historia<input aria-label="Szukaj rozmów" placeholder="Szukaj rozmów..." value={search} onChange={e=>setSearch(e.target.value)} className="mt-2 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-xs text-fg"/></label>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        {sessions.filter(s=>s.title.toLowerCase().includes(search.toLowerCase())).map(s=><button key={s.id} data-testid="osa-session" aria-current={s.id===current.id?"page":undefined} onClick={()=>openSession(s.id)} className={(s.id===current.id?"bg-white/10 text-white":"text-dim hover:bg-white/5")+" mb-1 block w-full rounded-lg px-3 py-3 text-left text-xs"}><span className="block truncate font-medium">{s.title}</span><span className="mt-1 block text-[10px] opacity-70">{AGENTS.find(a=>a.id===s.agent)?.name} · {s.messages.length} wiadomości</span></button>)}
      </div><button onClick={()=>go("home")} aria-label="Powrót do OSA Proof" className="focus-ring border-t border-white/10 px-3 py-3 text-left text-xs text-cyan hover:bg-white/5">← OSA Proof / Workspace</button><p className="border-t border-white/10 p-3 text-[10px] text-dim">HISTORIA LOKALNA · BEZ SYNCHRONIZACJI</p>
    </aside>
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-[30px] shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#0b111c] px-3 text-[10px] sm:px-5"><button type="button" aria-label="Powrót do frameworka OSA Proof" onClick={()=>go("home")} className="focus-ring rounded px-2 py-1 font-semibold text-cyan hover:bg-white/5">← OSA Proof / Framework</button><span className="truncate text-dim">BUDOWANIE / CZAT FLOTY AGENTÓW</span></div>
      <header className="flex min-h-[60px] shrink-0 items-center gap-2 border-b border-white/10 bg-[#0b111c] px-3 sm:px-5">
        <button onClick={()=>setMobileHistory(true)} aria-label="Otwórz historię" className="p-2 md:hidden">☰</button>
        <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">Czat floty agentów</h1><div className="truncate text-[10px] text-dim">Agenci · Runtime · APR · Proof</div></div>
        <button aria-label="Wybierz agenta" aria-expanded={agentOpen} onClick={()=>setAgentOpen(!agentOpen)} className="focus-ring max-w-[125px] truncate rounded-lg border border-line bg-panel px-2 py-2 text-xs sm:max-w-[195px]">{agent.icon} {agent.name} ▾</button>
        <button onClick={()=>setInspector(!inspector)} aria-expanded={inspector} className="focus-ring rounded-lg border border-line px-2 py-2 text-xs">{inspector?"Zamknij":"Inspektor"}</button>
      </header>
      {agentOpen&&<div data-testid="osa-agent-picker" className="absolute inset-x-2 top-[62px] z-20 max-h-[min(75dvh,530px)] overflow-y-auto rounded-xl border border-line2 bg-[#101b2a] p-3 shadow-2xl sm:left-auto sm:right-3 sm:w-[350px]">
        <div className="mb-2 flex items-center justify-between text-xs"><strong>Wybór agenta</strong><button onClick={()=>setAgentOpen(false)} aria-label="Zamknij wybór">✕</button></div>
        {AGENTS.map(a=><button key={a.id} onClick={()=>selectAgent(a.id)} aria-pressed={a.id===current.agent} className={(a.id===current.agent?"bg-cyan/10":"hover:bg-white/5")+" mb-1 w-full rounded-lg p-3 text-left"}><span className="flex items-center justify-between text-xs"><strong>{a.icon} {a.name}</strong><span className="text-[9px] text-dim">{a.state}</span></span><span className="mt-1 block text-[11px] text-dim">{a.purpose}</span></button>)}
        <p className="mt-2 text-[10px] text-warn">Widoczność agenta nie oznacza uruchomionego runtime. Mutacje wymagają Approval Gate.</p>
      </div>}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 px-3 py-2"><span className="flex min-w-0 items-center gap-2 text-[11px] text-dim"><button type="button" onClick={()=>selectAgent("hermes")} aria-label="Wybierz Hermesa" title="Hermes · wybierz agenta" className="osa-hermes-orb inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan/40 bg-cyan/10 text-cyan">✦</button><span className="truncate">Hermes · propozycje zatwierdzane przez operatora</span></span><span className="shrink-0 rounded-full border border-warn/40 px-2 py-1 text-[9px] text-warn">{status?.mode==="fixture"?"FIXTURE · MODEL NIEDOSTĘPNY":"MODEL NIEDOSTĘPNY"}</span></div>
      {inspector?
        <div data-testid="osa-inspector" aria-label="Inspektor wykonania" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-3xl"><h2 className="text-lg font-semibold">Śledzenie / Materiał dowodowy / Weryfikacja / Odtwarzanie</h2><p className="mt-2 text-xs text-dim">Tylko rzeczywiste wykonania; żadnych fikcyjnych dowodów.</p>
          <div className="mt-4 rounded-xl border border-line bg-panel p-4 text-xs">Tryb: {status?.mode||"NIEZNANY"} · Logowanie: {status?.auth_mode||"NIEZNANE"}<div className="mt-2">Zapisywanie: {status?.persistence||"NIEZNANE"}</div><div className="mt-2 break-all font-mono">Execution: {activeRun?.execution_id||"BRAK ZWERYFIKOWANEGO WYKONANIA"}</div><div className="mt-2">Weryfikacja: {activeRun?.verdict||"NIEZWERYFIKOWANO"} · Materiały: {activeRun?.evidence.length||0} · Zdarzenia: {activeRun?.events.length||0}</div></div>
          {activeRun?<><div className="mt-4 grid grid-cols-3 gap-2">{([["trace","Śledzenie"],["proofs","Dowody"],["replay","Odtwarzanie"]] as const).map(([v,label])=><button key={v} onClick={()=>go(v,{runId:activeRun.run_id})} className="rounded-lg border border-cyan/40 bg-cyan/10 p-3 text-xs text-cyan">{label} ↗</button>)}</div><ol className="mt-4 space-y-2">{activeRun.events.map(e=><li key={e.event_id} className="rounded-lg border border-line p-3 text-xs">#{e.sequence} · {e.type}</li>)}</ol></>:<p className="mt-4 text-xs text-dim">Uruchom dozwolone narzędzie albo OSA TRACE, aby pojawiło się prawdziwe wykonanie.</p>}
        </div></div>:
        <div aria-label="Wiadomości" className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6"><div className="mx-auto flex min-h-full max-w-[820px] flex-col">
          {!current.messages.length&&<div className="flex flex-1 flex-col items-center justify-center py-8 text-center"><div aria-hidden className="osa-hermes-hero mb-7 flex h-[100px] w-[100px] items-center justify-center rounded-full border border-cyan/35 bg-cyan/10 text-5xl text-cyan">✦</div><h2 className="text-2xl font-semibold">Czym zajmiemy się dzisiaj?</h2><p className="mt-3 max-w-xl text-sm text-dim">{agent.name} · {agent.purpose}. Jedna rozmowa i dowody z prawdziwego Runtime.</p><div className="mt-6 flex flex-wrap justify-center gap-2">{["Pokaż status runtime","Oblicz SHA-256 tekstu: OSA Proof","Status workera"].map(t=><button key={t} onClick={()=>setDraft(t)} className="rounded-full border border-line bg-panel px-3 py-2 text-xs">{t}</button>)}</div></div>}
          {current.messages.map(m=><article data-testid="osa-message" key={m.id} className={(m.role==="user"?"justify-end":"justify-start")+" mb-5 flex"}><div className={(m.role==="user"?"bg-[#19314b] text-white":"border border-white/10 bg-[#111b2a]")+" max-w-[min(92%,730px)] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-[13px] leading-6"}><div className="mb-1 text-[10px] uppercase tracking-wide text-dim">{m.role==="user"?"Ty":"Silnik OSA · "+m.status}</div>{m.text}{m.executionId&&<div className="mt-2 break-all border-t border-white/10 pt-2 font-mono text-[9px] text-dim">{m.executionId}</div>}</div></article>)}
          {busy&&<div role="status" className="text-xs text-dim">Silnik OSA · trwa wykonywanie żądania...</div>}<div ref={bottom}/></div></div>}
      {error&&<div role="alert" data-testid="osa-chat-notice" className="mx-3 mb-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[11px] text-warn">{error}<button className="ml-2 underline" onClick={()=>setError("")}>Zamknij</button></div>}
      {storageProblem&&<p role="alert" className="px-3 text-[11px] text-warn">Zapis historii na urządzeniu jest zablokowany.</p>}
      <div className="shrink-0 border-t border-white/10 bg-[#0b111c] px-3 py-3 sm:px-6"><form onSubmit={e=>void submit(e)} className="mx-auto max-w-[820px] rounded-2xl border border-line2 bg-[#101b2a] p-3 focus-within:border-cyan/50">
        <textarea aria-label="Wiadomość do OSA" data-testid="osa-composer" placeholder={"Wiadomość do "+agent.name+"..."} rows={2} maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={key} className="block max-h-[160px] min-h-[52px] w-full resize-y bg-transparent text-sm outline-none placeholder:text-dim"/>
        <div className="flex items-center gap-2 border-t border-white/5 pt-2"><label className="text-[10px] text-dim">Model <select aria-label="Wybierz model" value={current.model} onChange={e=>selectModel(e.target.value as ModelId)} className="rounded border border-line bg-panel p-1 text-[11px] text-fg"><option value="auto">Automatycznie</option><option value="nvidia">NVIDIA</option><option value="openrouter">OpenRouter</option></select></label><button type="button" onClick={()=>void trace()} disabled={busy} className="rounded border border-line p-2 text-[10px] text-cyan disabled:opacity-50">ŚLEDZENIE OSA</button><span className="ml-auto hidden text-[10px] text-dim sm:inline">BEZ PŁATNYCH WYWOŁAŃ</span>{busy?<button type="button" onClick={()=>{cancel();setError("Żądanie anulowano. Wynik niezweryfikowany.");}} className="ml-auto shrink-0 rounded-lg border border-line px-3 py-2 text-xs text-warn">Przerwij</button>:<button data-testid="osa-send" disabled={!draft.trim()} className="ml-auto shrink-0 rounded-lg bg-cyan px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">Wyślij ↑</button>}</div>
      </form><p className="mx-auto mt-2 max-w-[820px] text-center text-[10px] text-dim">P0: wybór agentów i bezpieczne narzędzia. Modele AI czekają na weryfikację bezpieczeństwa.</p></div>
    </div>
  </section>;
}
