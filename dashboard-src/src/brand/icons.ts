// STYLE LOCK · OSA icon system.
// Every visual comes from the supplied OSA design pack. Assets are embedded in four data modules.
import { SIDE } from "./assets-side";
import { GRID } from "./assets-grid";
import { CARD as CARD_ASSET } from "./assets-card";
import { LOGO as LOGO_ASSET } from "./assets-logo";

export const ICON = {
  home: SIDE.side_home, world: SIDE.side_world, agents: SIDE.side_agents, minions: SIDE.side_minions, workers: SIDE.side_workers, missions: SIDE.side_missions,
  execution: SIDE.side_execution, knowledge: SIDE.side_knowledge, repos: SIDE.side_repos, tools: SIDE.side_tools, teammesh: SIDE.side_teammesh,
  playground: SIDE.side_playground, monitor: SIDE.side_monitor, deployments: SIDE.side_deployments, logs: SIDE.side_logs, settings: SIDE.side_settings,
  bee: GRID.grid_agents, robot: GRID.grid_minions, spaceship: GRID.grid_spaceship, workflows: GRID.grid_workflows, skills: GRID.grid_skills, proofs: GRID.grid_proofs,
  observability: GRID.grid_observability, runtime: GRID.grid_runtime, scheduler: GRID.grid_scheduler, events: GRID.grid_events, cloud: GRID.grid_deployment,
  sandbox: GRID.grid_sandbox, security: GRID.grid_security, storage: GRID.grid_storage,
  planet: CARD_ASSET.card_world, helmet: CARD_ASSET.card_agents, minionBot: CARD_ASSET.card_minions, workerBot: CARD_ASSET.card_workers, target: CARD_ASSET.card_missions, play: CARD_ASSET.card_execution,
  cube: CARD_ASSET.card_knowledge, code: CARD_ASSET.card_repos, wrench: CARD_ASSET.card_tools, mesh: CARD_ASSET.card_teammesh, eye: CARD_ASSET.card_observe, rocket: CARD_ASSET.card_deploy,
} as const;
export type IconKey = keyof typeof ICON;

export const CARD = {
  world: CARD_ASSET.card_world, agents: CARD_ASSET.card_agents, minions: CARD_ASSET.card_minions, workers: CARD_ASSET.card_workers, missions: CARD_ASSET.card_missions, execution: CARD_ASSET.card_execution,
  knowledge: CARD_ASSET.card_knowledge, repos: CARD_ASSET.card_repos, tools: CARD_ASSET.card_tools, teammesh: CARD_ASSET.card_teammesh, observe: CARD_ASSET.card_observe, deploy: CARD_ASSET.card_deploy,
} as const;

export const LOGO = { wings: LOGO_ASSET.logo_bee_wings, bee: LOGO_ASSET.logo_bee, hex: LOGO_ASSET.logo_bee_hex } as const;
