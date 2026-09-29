import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Mission, RunResult, SessionRecord, TeamGraph } from "../../../packages/contracts/src";
import { enterLayer, getLayerProfile, listLayerProfiles } from "../../../packages/access-control/src";
import { createLocalDevIdentity } from "../../../packages/identity/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";
import { SessionStore } from "../../../packages/session/src";
import { validateTeamGraph } from "../../../packages/team-graph/src";

export class ApiState {
  readonly teams = new Map<string, TeamGraph>();
  readonly missions = new Map<string, Mission>();
  readonly runs = new Map<string, RunResult>();
  readonly sessions = new SessionStore();

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

function bearerToken(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

function authenticatedSession(request: IncomingMessage, state: ApiState): SessionRecord | undefined {
  const token = bearerToken(request);
  return token ? state.sessions.get(token) : undefined;
}

function requireSession(
  request: IncomingMessage,
  response: ServerResponse,
  state: ApiState
): SessionRecord | undefined {
  const session = authenticatedSession(request, state);
  if (!session) {
    send(response, 401, {
      error: "authenticated session required",
      code: "AUTHENTICATED_SESSION_REQUIRED",
    });
    return undefined;
  }
  return session;
}

export function createApiServer(registry: ExecutorRegistry, state = new ApiState()): Server {
  const runtime = new OsaRuntime(registry);

  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (method === "GET" && url.pathname === "/auth/providers") {
        return send(response, 200, [
          { provider: "local-dev", enabled: true, mode: "DEV_ONLY" },
          { provider: "github", enabled: false, mode: "OIDC_NOT_CONFIGURED" },
          { provider: "google", enabled: false, mode: "OIDC_NOT_CONFIGURED" },
          { provider: "microsoft", enabled: false, mode: "OIDC_NOT_CONFIGURED" },
        ]);
      }

      if (method === "POST" && url.pathname === "/auth/dev-login") {
        const body = await readJson<{ display_name?: string; email?: string }>(request);
        const identity = createLocalDevIdentity({
          display_name: body.display_name ?? "",
          email: body.email,
        });
        const session = state.sessions.create(identity);
        return send(response, 201, { identity, session });
      }

      if (method === "GET" && url.pathname === "/session") {
        const session = requireSession(request, response, state);
        if (!session) return;
        return send(response, 200, {
          session_id: session.session_id,
          identity: session.identity,
          created_at: session.created_at,
          expires_at: session.expires_at,
        });
      }

      if (method === "POST" && url.pathname === "/session/logout") {
        const token = bearerToken(request);
        if (!token || !state.sessions.revoke(token)) {
          return send(response, 401, {
            error: "authenticated session required",
            code: "AUTHENTICATED_SESSION_REQUIRED",
          });
        }
        return send(response, 200, { revoked: true });
      }

      if (method === "GET" && url.pathname === "/layers") {
        return send(response, 200, listLayerProfiles());
      }

      if (parts[0] === "layers" && parts.length === 2 && method === "GET") {
        const layer = getLayerProfile(parts[1]);
        return layer
          ? send(response, 200, layer)
          : send(response, 404, { error: "layer not found" });
      }

      if (parts[0] === "layers" && parts.length === 3 && parts[2] === "enter" && method === "POST") {
        const session = authenticatedSession(request, state);
        const decision = enterLayer(parts[1], session?.identity);
        if (!decision) return send(response, 404, { error: "layer not found" });
        if (decision.decision === "GATED" && decision.gate?.code === "AUTHENTICATED_SESSION_REQUIRED") {
          return send(response, 401, decision);
        }
        return send(response, 200, decision);
      }

      if (method === "POST" && url.pathname === "/teams") {
        const session = requireSession(request, response, state);
        if (!session) return;
        const graph = await readJson<TeamGraph>(request);
        validateTeamGraph(graph);
        state.teams.set(state.teamKey(graph.team_id, graph.version), structuredClone(graph));
        return send(response, 201, graph);
      }

      if (method === "GET" && parts[0] === "teams" && parts.length === 2) {
        const session = requireSession(request, response, state);
        if (!session) return;
        const version = url.searchParams.get("version");
        if (!version) return send(response, 400, { error: "version query parameter is required" });
        const graph = state.teams.get(state.teamKey(parts[1], version));
        return graph ? send(response, 200, graph) : send(response, 404, { error: "team not found" });
      }

      if (method === "POST" && url.pathname === "/missions") {
        const session = requireSession(request, response, state);
        if (!session) return;
        const mission = await readJson<Mission>(request);
        state.missions.set(mission.mission_id, structuredClone(mission));
        return send(response, 201, mission);
      }

      if (method === "POST" && parts[0] === "missions" && parts[2] === "run") {
        const session = requireSession(request, response, state);
        if (!session) return;
        const mission = state.missions.get(parts[1]);
        if (!mission) return send(response, 404, { error: "mission not found" });
        const graph = state.teams.get(state.teamKey(mission.team_id, mission.team_version));
        if (!graph) return send(response, 404, { error: "team version not found" });
        const run = await runtime.run(graph, mission);
        state.runs.set(run.run_id, structuredClone(run));
        return send(response, 201, run);
      }

      if (method === "GET" && parts[0] === "runs" && parts.length >= 2) {
        const session = requireSession(request, response, state);
        if (!session) return;
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
