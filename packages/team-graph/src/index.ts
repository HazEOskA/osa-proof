import { Mission, TeamGraph } from "../../contracts/src";

export class TeamGraphValidationError extends Error {}

export function validateTeamGraph(graph: TeamGraph): void {
  if (!graph.organization_id || !graph.project_id || !graph.team_id || !graph.version) {
    throw new TeamGraphValidationError("organization_id, project_id, team_id and version are required");
  }
  if (graph.agents.length === 0) {
    throw new TeamGraphValidationError("team graph must contain at least one agent");
  }

  const agentIds = new Set<string>();
  for (const agent of graph.agents) {
    if (!agent.agent_id || !agent.role || !agent.executor_ref) {
      throw new TeamGraphValidationError("each agent requires agent_id, role and executor_ref");
    }
    if (agentIds.has(agent.agent_id)) {
      throw new TeamGraphValidationError(`duplicate agent_id: ${agent.agent_id}`);
    }
    agentIds.add(agent.agent_id);
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.edge_id)) {
      throw new TeamGraphValidationError(`duplicate edge_id: ${edge.edge_id}`);
    }
    edgeIds.add(edge.edge_id);
    if (!agentIds.has(edge.from_agent_id) || !agentIds.has(edge.to_agent_id)) {
      throw new TeamGraphValidationError(`edge ${edge.edge_id} references unknown agent`);
    }
    if (edge.from_agent_id === edge.to_agent_id) {
      throw new TeamGraphValidationError(`edge ${edge.edge_id} cannot self-reference`);
    }
    if (edge.kind !== "handoff") {
      throw new TeamGraphValidationError(`unsupported edge kind: ${edge.kind}`);
    }
  }
}

export function validateMissionAgainstGraph(graph: TeamGraph, mission: Mission): void {
  if (mission.organization_id !== graph.organization_id || mission.project_id !== graph.project_id) {
    throw new TeamGraphValidationError("mission tenant identifiers do not match team graph");
  }
  if (mission.team_id !== graph.team_id || mission.team_version !== graph.version) {
    throw new TeamGraphValidationError("mission team_id/team_version do not match team graph");
  }
  if (!graph.agents.some((agent) => agent.agent_id === mission.entry_agent_id)) {
    throw new TeamGraphValidationError("mission entry_agent_id does not exist in team graph");
  }
  if (mission.requirements.length === 0) {
    throw new TeamGraphValidationError("proof-required mission must declare at least one acceptance requirement");
  }
}

export function getLinearExecutionOrder(graph: TeamGraph, entryAgentId: string): string[] {
  validateTeamGraph(graph);

  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges.filter((edge) => edge.kind === "handoff")) {
    const targets = outgoing.get(edge.from_agent_id) ?? [];
    targets.push(edge.to_agent_id);
    outgoing.set(edge.from_agent_id, targets);
  }

  const order: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = entryAgentId;

  while (current) {
    if (visited.has(current)) {
      throw new TeamGraphValidationError("handoff cycle detected; Slice #1 supports acyclic linear execution only");
    }
    visited.add(current);
    order.push(current);

    const next: string[] = outgoing.get(current) ?? [];
    if (next.length > 1) {
      throw new TeamGraphValidationError("branching handoffs are outside Vertical Slice #1");
    }
    current = next[0];
  }

  return order;
}
