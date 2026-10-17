import { osaGuideContext } from "./osa-guide";

export const CHAT_AGENTS = {
  jeff: { name:"Jeff", purpose:"Główny asystent OSA / Jeverson", instruction:"Jesteś Jeffem (Jeversonem), głównym asystentem OSA. Pomagasz użytkownikowi prowadzić jego projekty i wyjaśniasz stan systemu." },
  leader: { name:"Lider", purpose:"Team Graph, koordynacja i plan", instruction:"Jesteś Liderem floty OSA. Pomagasz planować pracę zespołu i analizować architekturę." },
  coding: { name:"Agent programistyczny", purpose:"Kod, repo i testy", instruction:"Jesteś Agentem programistycznym OSA. Pomagasz z kodem, testami i przeglądami." },
  commerce: { name:"Handel internetowy", purpose:"Sklep, produkty i integracje", instruction:"Jesteś Agentem handlu internetowego OSA. Pomagasz planować e-commerce i integracje." },
  hermes: { name:"Hermes", purpose:"Analiza i propozycje ulepszeń", instruction:"Jesteś Hermesem OSA. Analizujesz system i proponujesz ulepszenia. Nie deklaruj wykonania zmian bez wyniku Runtime." },
  security: { name:"Bezpieczeństwo", purpose:"Uprawnienia i audyt", instruction:"Jesteś Agentem bezpieczeństwa OSA. Analizujesz kod, uprawnienia i dowody." },
  research: { name:"Badania", purpose:"Badania i weryfikacja źródeł", instruction:"Jesteś Agentem badawczym OSA. Rozróżniaj potwierdzone źródła, hipotezy i brak danych." },
  runtime: { name:"Wykonanie / Dowody", purpose:"Runtime, tracing i proof", instruction:"Jesteś asystentem Runtime OSA. Wyjaśniasz wykonania, zdarzenia i dowody bez wymyślania wyników." },
  guide: { name:"OSA", purpose:"Przewodnik po frameworku", instruction:"Jesteś OSĄ — kontekstowym przewodnikiem po frameworku i jego samouczkiem." }
} as const;
export type ChatAgent = keyof typeof CHAT_AGENTS;
export interface ChatContext { agent?:unknown;history?:unknown;view?:unknown;tools?:boolean }
export function chatContext(context:ChatContext={}) {
  const agent=context.agent??"jeff";
  if(typeof agent!=="string"||!Object.hasOwn(CHAT_AGENTS,agent))throw Error("INVALID_AGENT");
  const history=context.history;
  if(history!==undefined&&(!Array.isArray(history)||history.length>8||history.some((m:unknown)=>!m||typeof m!=="object"||Array.isArray(m)||Object.keys(m).some(k=>!["role","content"].includes(k))||!("role" in m)||!["user","assistant"].includes(String(m.role))||!("content" in m)||typeof m.content!=="string"||m.content.length>1800)))throw Error("INVALID_HISTORY");
  let guide="";
  if(agent==="guide") { if(context.tools)throw Error("GUIDE_TOOLS_DENIED");try{guide=osaGuideContext(context.view);}catch{throw Error("INVALID_GUIDE_VIEW");} }
  return {system:"Jesteś asystentem ekosystemu OSA. Zawsze odpowiadaj po polsku. Odpowiedź modelu nie jest dowodem wykonania. Nie twierdź, że wykonałeś operacje poza rozmową bez dowodu Runtime. "+CHAT_AGENTS[agent as ChatAgent].instruction+(guide?" "+guide:""),
    history:(history??[]) as Array<{role:"user"|"assistant";content:string}>};
}
