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
    pick("Missions", "missions", true, I.missions), pick("Execution", "missions", true, I.execution), pick("Runtime", "ops:runtime", true, I.runtime),
    pick("Sandboxes", p("Sandboxes"), false, I.sandbox), pick("Scheduler", "ops:scheduler", true, I.scheduler), pick("Queues", "ops:queues", true, I.workers),
    pick("Deployments", "ops:deployments", true, I.deployments) ] },
  { title: "OBSERVE", items: [
    pick("Tracing", "trace", true, I.observability), pick("Events", "trace", true, I.events), pick("Monitoring", "ops:monitoring", true, I.monitor),
    pick("Logs", "ops:logs", true, I.logs), pick("Metrics", "ops:metrics", true, I.eye), pick("Topology", "ops:topology", true, I.teammesh) ] },
  { title: "PROOF", items: [
    pick("Proofs", "proofs", true, I.proofs), pick("Evidence", "proofs", true, I.knowledge), pick("Receipts", "proofs", true, I.storage),
    pick("Replay", "replay", true, I.play), pick("Verification", "proofs", true, I.security), pick("Audit Trail", "ops:audit", true, I.logs) ] },
  { title: "INTELLIGENCE", items: [
    pick("Models", "intel:models", true, I.minions), pick("Model Mesh", "intel:model-mesh", true, I.minionBot), pick("LLM Gateway", "intel:llm-gateway", true, I.workerBot),
    pick("Memory", "intel:memory", false, I.storage), pick("Knowledge", "intel:knowledge", false, I.cube), pick("Context Hub", "intel:context-hub", false, I.knowledge),
    pick("Datasets", "intel:datasets", true, I.logs), pick("Experiments", "ops:experiments", true, I.playground), pick("Evaluators", "intel:evaluators", true, I.target) ] },
  { title: "WORLD", items: [
    pick("World State", "world", true, I.world), pick("Knowledge Graph", "world", true, I.planet), pick("Timeline", "ops:timeline", true, I.events),
    pick("Dependencies", "ops:dependencies", true, I.workflows), pick("Architecture", "ops:architecture", true, I.runtime) ] },
  { title: "CONTROL", items: [
    pick("Policies", "ops:policies", true, I.security), pick("Permissions", "ops:permissions", true, I.helmet), pick("Secrets", "ops:secrets", true, I.sandbox),
    pick("Organizations", "ops:organizations", true, I.bee), pick("Cloud", p("Cloud"), false, I.cloud), pick("Infrastructure", p("Infrastructure"), false, I.cube) ] },
  { title: "SYSTEM", items: [ pick("Notifications", "ops:notifications", true, I.events), pick("Settings", "ops:settings", true, I.settings) ] },
];
export const HOME_ITEM: NavItem = { label: "Home", view: "home", built: true, icon: I.home };
