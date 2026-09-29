import { TeamGraph } from "../../../packages/contracts/src";
import { validateTeamGraph, getLinearExecutionOrder } from "../../../packages/team-graph/src";

export interface BuildResource {
  id: string;
  kind: "tools" | "skills" | "connections" | "prompts";
  name: string;
  description: string;
  config: Record<string, unknown>;
  revisions: Array<{ version: number; config: Record<string, unknown> }>;
}
export interface BuildWorkspace { team: TeamGraph; resources: BuildResource[] }

// Uses the same process lifetime as ApiState. This is configuration, not a claim
// that an endpoint, tool or protocol has been connected or executed.
export function validateBuildWorkspace(value: unknown): asserts value is BuildWorkspace {
  if (!value || typeof value !== "object") throw new Error("workspace must be an object");
  const workspace = value as BuildWorkspace;
  validateTeamGraph(workspace.team);
  if (!Array.isArray(workspace.resources)) throw new Error("resources must be an array");
  const ids = new Set<string>();
  for (const item of workspace.resources) {
    if (!item.id || !item.name?.trim() || !["tools", "skills", "connections", "prompts"].includes(item.kind)) throw new Error("invalid Build resource");
    if (ids.has(item.id)) throw new Error("duplicate Build resource id");
    ids.add(item.id);
    if (!item.config || typeof item.config !== "object" || Array.isArray(item.config) || !Array.isArray(item.revisions)) throw new Error("invalid resource configuration");
    if (item.kind === "connections") {
      if (!["MCP", "A2A"].includes(String(item.config.protocol))) throw new Error("protocol must be MCP or A2A");
      const endpoint = new URL(String(item.config.endpoint));
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("endpoint must be an http(s) URL without credentials or query");
    }
    // Store credential references only. Do not store authentication material.
    const secretKey = /^(password|token|api[_-]?key|authorization|secret)$/i;
    const inspect = (v: unknown): void => {
      if (v && typeof v === "object") for (const [key, child] of Object.entries(v)) {
        if (secretKey.test(key)) throw new Error("use credential_ref instead of secrets");
        inspect(child);
      }
    };
    inspect(item.config);
    inspect(item.revisions);
  }
  // A saved graph can contain several entry chains, but each must satisfy the
  // existing linear runtime contract; cycles and branching are rejected.
  for (const agent of workspace.team.agents) getLinearExecutionOrder(workspace.team, agent.agent_id);
}
