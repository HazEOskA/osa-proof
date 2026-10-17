import { useEffect, useState, type FormEvent } from "react";

export type ProviderId="nvidia"|"openrouter"|"openai"|"anthropic"|"compatible";
export interface ProviderInfo {id:ProviderId;name:string;configured:boolean;model:string;allow_paid:boolean;source:string}
export interface ProviderStatus {providers:ProviderInfo[];storage:string;key_entry_available:boolean}
export const PROVIDERS:Array<{id:ProviderId;name:string;defaultModel:string}>= [
  {id:"nvidia",name:"NVIDIA",defaultModel:"nvidia/nemotron-3-super-120b-a12b"},
  {id:"openrouter",name:"OpenRouter",defaultModel:"openrouter/free"},
  {id:"openai",name:"OpenAI",defaultModel:""},
  {id:"anthropic",name:"Anthropic",defaultModel:""},
  {id:"compatible",name:"Inne API zgodne z OpenAI",defaultModel:""}
];
export async function providerStatus():Promise<ProviderStatus>{const r=await fetch("/api/models/status",{cache:"no-store"});if(!r.ok)throw Error("Nie można odczytać połączeń API.");return r.json();}
export default function ApiConnections({onSaved}:{onSaved?:()=>void}){
  const [status,setStatus]=useState<ProviderStatus|null>(null),[provider,setProvider]=useState<ProviderId>("openrouter"),[model,setModel]=useState("openrouter/free"),[secret,setSecret]=useState(""),[baseUrl,setBaseUrl]=useState(""),[allowPaid,setAllowPaid]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  async function reload(){setStatus(await providerStatus());}
  useEffect(()=>{void reload().catch(e=>setNotice(e.message));},[]);
  function choose(id:ProviderId){setProvider(id);setSecret("");setBaseUrl("");setAllowPaid(false);setNotice("");setModel(status?.providers.find(p=>p.id===id)?.model||PROVIDERS.find(p=>p.id===id)?.defaultModel||"");}
  async function save(e:FormEvent){
    e.preventDefault();if(busy)return;const apiKey=secret;setSecret("");setBusy(true);setNotice("");
    try{const r=await fetch("/api/models/connections",{method:"POST",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({provider,model,apiKey,allowPaid,...(provider==="compatible"?{baseUrl}:{})})});const data=await r.json();if(!r.ok)throw Error(data.error||"Nie zapisano połączenia.");setNotice(data.storage==="PROCESS_MEMORY"?"Połączono w bieżącej sesji serwera. Po restarcie lub zmianie instancji dodaj klucz ponownie. Klucz nie jest zwracany do przeglądarki.":"Połączenie zapisane na serwerze. Klucz nie jest zwracany do przeglądarki.");await reload();window.dispatchEvent(new Event("osa-api-connections"));onSaved?.();}
    catch(e){setNotice(e instanceof Error?e.message:"Nie zapisano połączenia.");}finally{setBusy(false);}
  }
  async function remove(id:ProviderId){setBusy(true);setNotice("");try{const r=await fetch("/api/models/connections/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider:id})});if(!r.ok)throw Error("Nie usunięto połączenia.");await reload();window.dispatchEvent(new Event("osa-api-connections"));onSaved?.();setNotice("Własny klucz usunięty z serwera.");}catch(e){setNotice(e instanceof Error?e.message:"Nie usunięto połączenia.");}finally{setBusy(false);}}
  const inputClass="focus-ring min-h-[44px] w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm";
  return <div data-testid="osa-api-connections" className="min-w-0 space-y-5 text-sm">
    <div><h2 className="text-xl font-semibold">Połączenia API</h2><p className="mt-2 text-xs leading-5 text-dim">Dodaj dostawcę i model dla Jeffa, Hermesa i pozostałych agentów. Klucz wpisujesz tutaj, a zapisuje go wyłącznie serwer.</p></div>
    <div className="grid gap-2 sm:grid-cols-2">{PROVIDERS.map(p=>{const c=status?.providers.find(c=>c.id===p.id);return <div key={p.id} className="min-w-0 rounded-xl border border-line bg-panel p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{p.name}</strong><span className={c?.configured?"text-cyan":"text-dim"}>{c?.configured?"Skonfigurowano":"Dodaj klucz"}</span></div><p className="mt-1 break-all text-[11px] text-dim">{c?.model||"Model ustawisz w formularzu"}</p><div className="mt-2 flex flex-wrap gap-3 text-xs"><button type="button" onClick={()=>choose(p.id)} className="focus-ring text-cyan underline">{c?.configured?"Zmień połączenie":"Dodaj połączenie"}</button>{c?.source==="PRIVATE_SERVER_STORE"&&<button type="button" disabled={busy} onClick={()=>void remove(p.id)} className="focus-ring text-warn underline">Usuń własny klucz</button>}</div></div>;})}</div>
    <form onSubmit={e=>void save(e)} autoComplete="off" className="space-y-3 rounded-xl border border-cyan/25 p-4">
      <label className="block text-xs">Dostawca API<select aria-label="Dostawca API" value={provider} onChange={e=>choose(e.target.value as ProviderId)} className={inputClass+" mt-1"}>{PROVIDERS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {provider==="compatible"&&<label className="block text-xs">Adres bazowy API<input aria-label="Adres bazowy API" type="url" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} required placeholder="https://api.groq.com/openai/v1" className={inputClass+" mt-1"}/><span className="mt-1 block text-[10px] text-dim">Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Hugging Face, Gemini lub Cohere. Adres do katalogu /v1, bez /chat/completions.</span></label>}
      <label className="block text-xs">Identyfikator modelu<input aria-label="Identyfikator modelu" required maxLength={200} value={model} onChange={e=>setModel(e.target.value)} placeholder="ID modelu z katalogu dostawcy" className={inputClass+" mt-1"}/></label>
      <label className="block text-xs">Klucz API<input aria-label="Klucz API" type="password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" required maxLength={4096} value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Wpisz nowy klucz — zapisany klucz nie jest wyświetlany" className={inputClass+" mt-1"}/></label>
      <label className="flex items-start gap-2 text-xs leading-5 text-dim"><input type="checkbox" checked={allowPaid} onChange={e=>setAllowPaid(e.target.checked)} className="mt-1"/>Zezwalam na modele rozliczane z mojego konta u tego dostawcy. Bez tej zgody dostępne są bezpłatny Nemotron i warianty :free OpenRouter.</label>
      <button type="submit" disabled={busy||!secret.trim()||!model.trim()} className="focus-ring min-h-[44px] rounded-lg bg-cyan px-4 font-semibold text-black disabled:opacity-50">{busy?"Zapisuję…":status?.storage==="PROCESS_MEMORY"?"Połącz w sesji serwera":"Zapisz połączenie na serwerze"}</button>
    </form>
    {notice&&<p role="status" className="break-words rounded-lg border border-line bg-panel p-3 text-xs leading-5">{notice}</p>}
    {status?.storage==="PROCESS_MEMORY"&&<p className="rounded-lg border border-line p-3 text-xs leading-5 text-dim">Połączenia są przechowywane na serwerze do godziny. Restart lub zmiana instancji wymaga ponownego dodania klucza. Trwały zapis w chmurze nie jest jeszcze podłączony.</p>}
    {status&&!status.key_entry_available&&<p className="text-xs leading-5 text-warn">Trwały magazyn kluczy nie jest jeszcze podłączony do tego wdrożenia. Dostawcy skonfigurowani w środowisku serwera działają niezależnie.</p>}
    <p className="text-[10px] leading-5 text-dim">Klucze API nie są zapisywane w localStorage, sessionStorage ani historii rozmowy. Własne połączenia są przypisane do tej przeglądarki przez ciasteczko HttpOnly; usunięcie ciasteczek usuwa dostęp do nich z urządzenia.</p>
  </div>;
}
