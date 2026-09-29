import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Mission, RunResult, TeamGraph } from "../../../packages/contracts/src";
import { enterLayer, getLayerProfile, listLayerProfiles } from "../../../packages/access-control/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";
import { validateTeamGraph } from "../../../packages/team-graph/src";
import { createBuiltinIntelligence, IntelligenceRegistry } from "../../../packages/intelligence/src";
import { CommitChanges, DatasetError, DatasetStore, verifyDatasetVersion } from "../../../packages/datasets/src";

export class ApiState {
  readonly teams = new Map<string, TeamGraph>();
  readonly missions = new Map<string, Mission>();
  readonly runs = new Map<string, RunResult>();
  readonly intelligence: IntelligenceRegistry;
  readonly datasets: DatasetStore;

  constructor(intelligence: IntelligenceRegistry = createBuiltinIntelligence(), datasets: DatasetStore = new DatasetStore()) {
    this.intelligence = intelligence;
    this.datasets = datasets;
  }

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

      if (method === "GET" && url.pathname === "/layers") {
        return send(response, 200, listLayerProfiles());
      }

      if (parts[0] === "layers" && parts.length === 2 && method === "GET") {
        const layer = getLayerProfile(parts[1]);
        return layer ? send(response, 200, layer) : send(response, 404, { error: "layer not found" });
      }

      if (parts[0] === "layers" && parts.length === 3 && parts[2] === "enter" && method === "POST") {
        const decision = enterLayer(parts[1]);
        return decision ? send(response, 200, decision) : send(response, 404, { error: "layer not found" });
      }

      if (method === "GET" && url.pathname === "/intelligence") {
        return send(response, 200, await state.intelligence.reportAll());
      }

      if (method === "GET" && parts[0] === "intelligence" && parts.length === 2) {
        const report = await state.intelligence.report(parts[1]);
        return report ? send(response, 200, report) : send(response, 404, { error: "intelligence module not found" });
      }

      if (parts[0] === "datasets") {
        const asOf = url.searchParams.get("as_of") ?? undefined;
        if (parts.length === 1 && method === "POST") {
          const body = await readJson<Parameters<DatasetStore["create"]>[0]>(request);
          return send(response, 201, state.datasets.create(body));
        }
        if (parts.length === 1 && method === "GET") return send(response, 200, state.datasets.list());
        if (parts.length === 2 && method === "GET") return send(response, 200, state.datasets.get(parts[1], asOf));
        if (parts.length === 3 && parts[2] === "versions" && method === "GET") return send(response, 200, state.datasets.listVersions(parts[1]));
        if (parts.length === 3 && parts[2] === "versions" && method === "POST") {
          return send(response, 201, state.datasets.commit(parts[1], await readJson<CommitChanges>(request)));
        }
        if (parts.length === 3 && parts[2] === "verify" && method === "GET") {
          return send(response, 200, verifyDatasetVersion(state.datasets.get(parts[1], asOf)));
        }
        if (parts.length === 4 && parts[2] === "tags" && method === "PUT") {
          const body = await readJson<{ version: number }>(request);
          return send(response, 200, state.datasets.tag(parts[1], parts[3], body.version));
        }
      }

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
      if (error instanceof DatasetError) {
        return send(response, error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400, { error: message });
      }
      return send(response, 400, { error: message });
    }
  });
}
