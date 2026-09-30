import type { ViewId } from "./ctx";
import { ICON } from "./brand/icons";
export interface NavItem { label: string; view: ViewId; built: boolean; icon: string }
export interface NavGroup { title: string; items: NavItem[] }
const p = (l: string): ViewId => `pending:${l}`;
const I = ICON;
const pick = (label: string, view: ViewId, built: boolean, icon: string): NavItem => ({ label, view, built, icon });
export const NAV: NavGroup[] = [
  { title: "BUILD", items: [
    pick("Agenci", "build:agents", true, I.agents), pick("Agent Mesh", "build:mesh", true, I.bee), pick("Workflowy", "build:workflows", true, I.workflows),
    pick("Narzędzia", "build:tools", true, I.tools), pick("Skille", "build:skills", true, I.skills), pick("MCP / A2A", "build:connections", true, I.robot),
    pick("Prompty", "build:prompts", true, I.code), pick("Studio", "build:studio", true, I.spaceship), pick("Playground", "build:playground", true, I.playground) ] },
  { title: "RUNTIME", items: [
    pick("Missions", "missions", true, I.missions), pick("Execution", "missions", true, I.execution), pick("Runtime", p("Runtime"), false, I.runtime),
    pick("Sandboxes", p("Sandboxes"), false, I.sandbox), pick("Scheduler", p("Scheduler"), false, I.scheduler), pick("Queues", p("Queues"), false, I.workers),
    pick("Deployments", p("Deployments"), false, I.deployments) ] },
  { title: "OBSERVE", items: [
    pick("Tracing", "trace", true, I.observability), pick("Events", "trace", true, I.events), pick("Monitoring", p("Monitoring"), false, I.monitor),
    pick("Logs", p("Logs"), false, I.logs), pick("Metrics", p("Metrics"), false, I.eye), pick("Topology", p("Topology"), false, I.teammesh) ] },
  { title: "PROOF", items: [
    pick("Proofs", "proofs", true, I.proofs), pick("Evidence", "proofs", true, I.knowledge), pick("Receipts", "proofs", true, I.storage),
    pick("Replay", "replay", true, I.play), pick("Verification", "proofs", true, I.security), pick("Audit Trail", p("Audit Trail"), false, I.logs) ] },
  { title: "INTELLIGENCE", items: [
    pick("Models", p("Models"), false, I.minions), pick("Model Mesh", p("Model Mesh"), false, I.minionBot), pick("LLM Gateway", p("LLM Gateway"), false, I.workerBot),
    pick("Memory", p("Memory"), false, I.storage), pick("Knowledge", p("Knowledge"), false, I.cube), pick("Context Hub", p("Context Hub"), false, I.knowledge),
    pick("Datasets", p("Datasets"), false, I.logs), pick("Experiments", p("Experiments"), false, I.playground), pick("Evaluators", p("Evaluators"), false, I.target) ] },
  { title: "WORLD", items: [
    pick("World State", "world", true, I.world), pick("Knowledge Graph", "world", true, I.planet), pick("Timeline", p("Timeline"), false, I.events),
    pick("Dependencies", p("Dependencies"), false, I.workflows), pick("Architecture", p("Architecture"), false, I.runtime) ] },
  { title: "CONTROL", items: [
    pick("Policies", p("Policies"), false, I.security), pick("Permissions", p("Permissions"), false, I.helmet), pick("Secrets", p("Secrets"), false, I.sandbox),
    pick("Organizations", p("Organizations"), false, I.bee), pick("Cloud", p("Cloud"), false, I.cloud), pick("Infrastructure", p("Infrastructure"), false, I.cube) ] },
  { title: "SYSTEM", items: [ pick("Notifications", p("Notifications"), false, I.events), pick("Settings", p("Settings"), false, I.settings) ] },
];
export const HOME_ITEM: NavItem = { label: "Home", view: "home", built: true, icon: I.home };
