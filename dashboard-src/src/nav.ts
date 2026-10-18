import type { ViewId } from "./ctx";
import { ICON } from "./brand/icons";
export interface NavItem { label: string; view: ViewId; built: boolean; icon: string }
export interface NavGroup { title: string; items: NavItem[] }
const p = (l: string): ViewId => `pending:${l}`;
const I = ICON;
const pick = (label: string, view: ViewId, built: boolean, icon: string): NavItem => ({ label, view, built, icon });
export const NAV: NavGroup[] = [
  { title: "BUDOWANIE", items: [
    pick("Laboratorium wdrożeń", "delivery-lab", true, I.agents),
    pick("Czat floty agentów", "jeverson-chat", true, I.agents),
    pick("Agenci", "build:agents", true, I.agents), pick("Sieć agentów", "build:mesh", true, I.bee), pick("Przepływy pracy", "build:workflows", true, I.workflows),
    pick("Narzędzia", "build:tools", true, I.tools), pick("Umiejętności", "build:skills", true, I.skills), pick("MCP / A2A", "build:connections", true, I.robot),
    pick("Prompty", "build:prompts", true, I.code), pick("Studio", "build:studio", true, I.spaceship), pick("Plac testowy", "build:playground", true, I.playground) ] },
  { title: "WYKONANIE", items: [
    pick("Missions", "missions", true, I.missions), pick("Wykonania", "missions", true, I.execution), pick("Silnik wykonawczy", "ops:runtime", true, I.runtime),
    pick("Piaskownice", p("Piaskownice"), false, I.sandbox), pick("Harmonogram", "ops:scheduler", true, I.scheduler), pick("Kolejki", "ops:queues", true, I.workers),
    pick("Wdrożenia", "ops:deployments", true, I.deployments) ] },
  { title: "MONITORING", items: [
    pick("Śledzenie", "trace", true, I.observability), pick("Zdarzenia", "trace", true, I.events), pick("Monitorowanie", "ops:monitoring", true, I.monitor),
    pick("Dzienniki", "ops:logs", true, I.logs), pick("Metryki", "ops:metrics", true, I.eye), pick("Topologia", "ops:topology", true, I.teammesh) ] },
  { title: "DOWODY", items: [
    pick("Dowody", "proofs", true, I.proofs), pick("Materiał dowodowy", "proofs", true, I.knowledge), pick("Potwierdzenia", "proofs", true, I.storage),
    pick("Replay", "replay", true, I.play), pick("Weryfikacja", "proofs", true, I.security), pick("Historia audytu", "ops:audit", true, I.logs) ] },
  { title: "INTELIGENCJA", items: [
    pick("Modele", "intel:models", true, I.minions), pick("Sieć modeli", "intel:model-mesh", true, I.minionBot), pick("Bramka LLM", "intel:llm-gateway", true, I.workerBot),
    pick("Pamięć", "intel:memory", true, I.storage), pick("Wiedza", "ops:knowledge", true, I.cube), pick("Centrum kontekstu", "intel:context-hub", false, I.knowledge),
    pick("Zbiory danych", "intel:datasets", true, I.logs), pick("Eksperymenty", "ops:experiments", true, I.playground), pick("Ewaluatory", "intel:evaluators", true, I.target) ] },
  { title: "WEB3", items: [
    pick("Przegląd Web3", "web3:overview", true, I.planet), pick("Sieci blockchain", "web3:chains", true, I.world),
    pick("Portfele", "web3:wallets", true, I.storage), pick("Encje", "web3:entities", true, I.cube),
    pick("Zdarzenia", "web3:events", true, I.events), pick("Transakcje", "web3:transactions", true, I.execution),
    pick("Agenci", "web3:agents", true, I.agents), pick("Protokoły", "web3:protocols", true, I.tools),
    pick("Ryzyko", "web3:risk", true, I.security), pick("Proof", "web3:proof", true, I.proofs) ] },
  { title: "ŚWIAT", items: [
    pick("Stan świata", "world", true, I.world), pick("Wiedza Graph", "world", true, I.planet), pick("Oś czasu", "ops:timeline", true, I.events),
    pick("Zależności", "ops:dependencies", true, I.workflows), pick("Architektura", "ops:architecture", true, I.runtime) ] },
  { title: "KONTROLA", items: [
    pick("Zasady", "ops:policies", true, I.security), pick("Uprawnienia", "ops:permissions", true, I.helmet), pick("Sekrety", "ops:secrets", true, I.sandbox),
    pick("Organizacje", "ops:organizations", true, I.bee), pick("Chmura", p("Chmura"), false, I.cloud), pick("Infrastruktura", p("Infrastruktura"), false, I.cube) ] },
  { title: "SYSTEM", items: [ pick("Powiadomienia", "ops:notifications", true, I.events), pick("Ustawienia", "ops:settings", true, I.settings) ] },
];
export const HOME_ITEM: NavItem = { label: "Strona główna", view: "home", built: true, icon: I.home };
