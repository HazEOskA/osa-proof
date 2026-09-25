import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Mission, RunResult, TeamGraph } from "../../../packages/contracts/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";
import { validateTeamGraph } from "../../../packages/team-graph/src";

export class ApiState {
  readonly teams = new Map<string, TeamGraph>();
  readonly missions = new Map<string, Mission>();
  readonly runs = new Map<string, RunResult>();

  teamKey(teamId: string, version: string): string {
    return `${teamId}@${version}`;
  }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createApiServer(registry: ExecutorRegistry, state = new ApiState()): Server {
  const runtime = new OsaRuntime(registry);

  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (method === "POST" && url.pathname === "/teams") {
        const graph = await readJson<TeamGraph>(request);
        validateTeamGraph(graph);
        state.teams.set(state.teamKey(graph.team_id, graph.version), structuredClone(graph));
        return send(response, 201, graph);
      }

      if (method === "GET" && parts[0] === "teams" && parts.length === 2) {
        const version = url.searchParams.get("version");
        if (!version) return send(response, 400, { error: "version query parameter is required" });
        const graph = state.teams.get(state.teamKey(parts[1], version));
        return graph ? send(response, 200, graph) : send(response, 404, { error: "team not found" });
      }

      if (method === "POST" && url.pathname === "/missions") {
        const mission = await readJson<Mission>(request);
        state.missions.set(mission.mission_id, structuredClone(mission));
        return send(response, 201, mission);
      }

      if (method === "POST" && parts[0] === "missions" && parts[2] === "run") {
        const mission = state.missions.get(parts[1]);
        if (!mission) return send(response, 404, { error: "mission not found" });
        const graph = state.teams.get(state.teamKey(mission.team_id, mission.team_version));
        if (!graph) return send(response, 404, { error: "team version not found" });
        const run = await runtime.run(graph, mission);
        state.runs.set(run.run_id, structuredClone(run));
        return send(response, 201, run);
      }

      if (method === "GET" && parts[0] === "runs" && parts.length >= 2) {
        const run = state.runs.get(parts[1]);
        if (!run) return send(response, 404, { error: "run not found" });
        if (parts.length === 2) return send(response, 200, run);
        if (parts[2] === "events") return send(response, 200, run.events);
        if (parts[2] === "evidence") return send(response, 200, run.evidence);
        if (parts[2] === "proof") return send(response, 200, run.proof);
      }

      return send(response, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return send(response, 400, { error: message });
    }
  });
}
