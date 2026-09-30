import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Mission, RunResult, SessionRecord, TeamGraph } from "../../../packages/contracts/src";
import { enterLayer, getLayerProfile, listLayerProfiles } from "../../../packages/access-control/src";
import { createLocalDevIdentity } from "../../../packages/identity/src";
import { ExecutorRegistry, OsaRuntime } from "../../../packages/runtime/src";
import { SessionStore } from "../../../packages/session/src";
import { validateTeamGraph } from "../../../packages/team-graph/src";
import { createBuiltinIntelligence, IntelligenceRegistry } from "../../../packages/intelligence/src";
import { CommitChanges, DatasetError, DatasetStore, verifyDatasetVersion } from "../../../packages/datasets/src";
import { EvaluatorError, EvaluatorInput, EvaluatorStore } from "../../../packages/evaluators/src";
import { BuildWorkspace, validateBuildWorkspace } from "./build";

// "session" (default): teams, missions, runs and run results need a DEV session.
// "open": no login, for the Vercel preview dashboard; every open-mode request acts as OPEN_MODE_SESSION.
export type AuthMode = "session" | "open";

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

// Fails closed: unset means "session"; any value other than session or open refuses to start.
export function loadAuthMode(env: Record<string, string | undefined>): AuthMode {
  const mode = env.OSA_AUTH_MODE?.trim();
  if (!mode || mode === "session") return "session";
  if (mode === "open") return "open";
  throw new AuthConfigError("OSA_AUTH_MODE must be one of: session, open");
}

const OPEN_MODE_SESSION: SessionRecord = Object.freeze({
  session_id: "ses_open_mode",
  token: "",
  identity: Object.freeze({
    identity_id: "idn_open_mode",
    provider: "local-dev",
    subject: "local-dev:open-mode",
    display_name: "OPEN MODE (no login)",
    organization_id: "org_dev_local",
    roles: Object.freeze(["developer"]) as unknown as string[],
    verified: true,
  }),
  created_at: "1970-01-01T00:00:00.000Z",
  expires_at: "9999-12-31T23:59:59.999Z",
}) as SessionRecord;

export class ApiState {
  buildWorkspace?: BuildWorkspace;
  readonly teams = new Map<string, TeamGraph>();
  readonly missions = new Map<string, Mission>();
  readonly runs = new Map<string, RunResult>();
  readonly sessions = new SessionStore();
  readonly intelligence: IntelligenceRegistry;
  readonly datasets: DatasetStore;
  readonly evaluators: EvaluatorStore;

  constructor(
    intelligence: IntelligenceRegistry = createBuiltinIntelligence(),
    datasets: DatasetStore = new DatasetStore(),
    evaluators: EvaluatorStore = new EvaluatorStore(),
    readonly authMode: AuthMode = "session"
  ) {
    this.intelligence = intelligence;
    this.datasets = datasets;
    this.evaluators = evaluators;
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

function bearerToken(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

function authenticatedSession(request: IncomingMessage, state: ApiState): SessionRecord | undefined {
  const token = bearerToken(request);
  const session = token ? state.sessions.get(token) : undefined;
  return session ?? (state.authMode === "open" ? structuredClone(OPEN_MODE_SESSION) : undefined);
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

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  registry: ExecutorRegistry,
  state = new ApiState(),
  executionDescription: Record<string, unknown> = { mode: "UNKNOWN" }
): Promise<void> {
  const runtime = new OsaRuntime(registry);

  try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

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

      if (url.pathname === "/build/status" && method === "GET") {
        return send(response, 200, { ...executionDescription, auth_mode: state.authMode, persistence: "PROCESS_MEMORY", protocols: { MCP: "UNSUPPORTED", A2A: "UNSUPPORTED" } });
      }

      if (url.pathname === "/build/workspace" && method === "GET") {
        if (!requireSession(request, response, state)) return;
        return state.buildWorkspace ? send(response, 200, state.buildWorkspace) : send(response, 404, { error: "Build workspace not saved in this process" });
      }
      if (url.pathname === "/build/workspace" && method === "POST") {
        // Saving a workspace registers its Team Graph, so it needs the same session as POST /teams.
        if (!requireSession(request, response, state)) return;
        const workspace = await readJson<BuildWorkspace>(request);
        validateBuildWorkspace(workspace);
        state.buildWorkspace = structuredClone(workspace);
        const graph = workspace.team;
        state.teams.set(state.teamKey(graph.team_id, graph.version), structuredClone(graph));
        return send(response, 201, { ...workspace, persistence: "PROCESS_MEMORY" });
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

      if (parts[0] === "evaluators") {
        if (parts.length === 1 && method === "POST") return send(response, 201, state.evaluators.register(await readJson<EvaluatorInput>(request)));
        if (parts.length === 1 && method === "GET") return send(response, 200, state.evaluators.list());
        if (parts.length === 2 && method === "GET") return send(response, 200, state.evaluators.get(parts[1]));
      }

      if (parts[0] === "runs" && parts.length === 3 && (parts[2] === "evaluations" || parts[2] === "labels")) {
        const session = requireSession(request, response, state);
        if (!session) return;
        const run = state.runs.get(parts[1]);
        if (!run) return send(response, 404, { error: "run not found" });
        if (parts[2] === "evaluations" && method === "GET") return send(response, 200, state.evaluators.resultsFor(run.run_id));
        if (parts[2] === "evaluations" && method === "POST") {
          const body = await readJson<{ evaluator_ids: string[]; example?: { dataset_id: string; as_of?: string; example_id: string } }>(request);
          const dataset = body.example ? state.datasets.get(body.example.dataset_id, body.example.as_of) : undefined;
          return send(response, 201, state.evaluators.evaluate(run, body.evaluator_ids, { dataset, example_id: body.example?.example_id }));
        }
        if (parts[2] === "labels" && method === "POST") {
          return send(response, 201, state.evaluators.label(run, await readJson<{ evaluator_id: string; labeler: string; score: number; comment?: string }>(request)));
        }
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
    if (error instanceof DatasetError || error instanceof EvaluatorError) {
      return send(response, error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400, { error: message });
    }
    return send(response, 400, { error: message });
  }
}

export function createApiServer(registry: ExecutorRegistry, state = new ApiState(), executionDescription: Record<string, unknown> = { mode: "UNKNOWN" }): Server {
  return createServer((request, response) => {
    void handleApiRequest(request, response, registry, state, executionDescription);
  });
}
