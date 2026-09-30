import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Mission, RunResult, SessionRecord, TeamGraph } from "../../../packages/contracts/src";
import { enterLayer, getLayerProfile, listLayerProfiles } from "../../../packages/access-control/src";
import { createLocalDevIdentity } from "../../../packages/identity/src";
import { ExecutorRegistry, OsaRuntime, MissionKernel, MissionStore, MissionConflictError } from "../../../packages/runtime/src";
import { SessionStore } from "../../../packages/session/src";
import { validateTeamGraph } from "../../../packages/team-graph/src";
import { createBuiltinIntelligence, IntelligenceRegistry } from "../../../packages/intelligence/src";
import { CommitChanges, DatasetError, DatasetStore, verifyDatasetVersion } from "../../../packages/datasets/src";
import { EvaluatorError, EvaluatorInput, EvaluatorStore } from "../../../packages/evaluators/src";
import { ControlError, DeploymentStore, JobQueue, OrganizationStore, PERMISSIONS, PolicyInput, PolicyStore, secretStatus } from "../../../packages/control/src";
import { ExperimentError, ExperimentStore } from "../../../packages/experiments/src";
import { KnowledgeError, KnowledgeStore } from "../../../packages/knowledge/src";
import { BuildWorkspace, validateBuildWorkspace } from "./build";
import { BrainControlPlane, verifyBrainPlan } from "../../../packages/brain/src";

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
  readonly deployments = new DeploymentStore();
  readonly experiments = new ExperimentStore();
  readonly queue = new JobQueue();
  readonly knowledge = new KnowledgeStore();
  readonly policies = new PolicyStore();
  readonly organizations = new OrganizationStore();
  readonly missionKernel: MissionKernel;

  constructor(
    intelligence: IntelligenceRegistry = createBuiltinIntelligence(),
    datasets: DatasetStore = new DatasetStore(),
    evaluators: EvaluatorStore = new EvaluatorStore(),
    readonly authMode: AuthMode = "session",
    missionStore?: MissionStore,
    brain?: BrainControlPlane
  ) {
    this.intelligence = intelligence;
    this.datasets = datasets;
    this.evaluators = evaluators;
    this.missionKernel = new MissionKernel(missionStore, undefined, brain);
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

  // A deployment pins the graph: the mission runs against the deployed version, whatever it names,
  // and only after every enabled policy allows it.
  async function runThroughDeployment(deploymentId: string, requested: Mission | undefined) {
    const deployment = state.deployments.get(deploymentId);
    if (deployment.status !== "ACTIVE") throw new ControlError(`deployment ${deployment.deployment_id} is ${deployment.status}, not ACTIVE`, "conflict");
    if (!requested || requested.team_id !== deployment.team_id) throw new ControlError("mission.team_id must match the deployment's team");
    const mission: Mission = { ...structuredClone(requested), team_version: deployment.team_version };
    const policy = state.policies.evaluate(deployment.graph, mission);
    if (!policy.allowed) return { deployment_id: deployment.deployment_id, graph_sha256: deployment.graph_sha256, policy, run: null };
    const run = await runtime.run(deployment.graph, mission);
    state.runs.set(run.run_id, structuredClone(run));
    return { deployment_id: deployment.deployment_id, graph_sha256: deployment.graph_sha256, policy, run };
  }

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
        return send(response, 200, { ...executionDescription, auth_mode: state.authMode, executors: registry.refs(), persistence: "PROCESS_MEMORY", mission_persistence: state.missionKernel.store.persistence, brain: state.missionKernel.brain.describe(), protocols: { MCP: "UNSUPPORTED", A2A: "UNSUPPORTED" } });
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

      if (parts[0] === "deployments") {
        if (parts.length === 1 && method === "GET") return send(response, 200, state.deployments.list());
        if (!requireSession(request, response, state)) return;
        if (parts.length === 1 && method === "POST") {
          const body = await readJson<{ team_id?: string; version?: string; environment: string; note?: string }>(request);
          const team = state.teams.get(state.teamKey(String(body.team_id), String(body.version)));
          if (!team) return send(response, 404, { error: "team version not found; register it with POST /teams first" });
          return send(response, 201, state.deployments.deploy({ team, environment: body.environment, note: body.note }));
        }
        if (parts.length === 2 && method === "GET") return send(response, 200, state.deployments.get(parts[1]));
        if (parts.length === 3 && parts[2] === "promote" && method === "POST") {
          const body = await readJson<{ note?: string }>(request);
          return send(response, 201, state.deployments.promote(parts[1], body.note));
        }
        if (parts.length === 2 && parts[1] === "rollback" && method === "POST") {
          const body = await readJson<{ team_id: string; environment: string }>(request);
          return send(response, 200, state.deployments.rollback(body.team_id, body.environment));
        }
        if (parts.length === 3 && parts[2] === "run" && method === "POST") {
          const body = await readJson<{ mission: Mission }>(request);
          const out = await runThroughDeployment(parts[1], body.mission);
          if (!out.policy.allowed) return send(response, 403, { error: "blocked by policy", code: "POLICY_DENIED", policy: out.policy });
          return send(response, 201, out);
        }
      }

      if (parts[0] === "experiments") {
        if (parts.length === 1 && method === "GET") return send(response, 200, state.experiments.list());
        if (parts.length === 2 && parts[1] === "compare" && method === "GET") {
          return send(response, 200, state.experiments.compare(String(url.searchParams.get("a")), String(url.searchParams.get("b"))));
        }
        if (parts.length === 2 && method === "GET") return send(response, 200, state.experiments.get(parts[1]));
        if (parts.length === 1 && method === "POST") {
          if (!requireSession(request, response, state)) return;
          const body = await readJson<{ name?: string; dataset_id: string; as_of?: string; team_id: string; version: string; evaluator_ids: string[]; split?: string }>(request);
          const graph = state.teams.get(state.teamKey(String(body.team_id), String(body.version)));
          if (!graph) return send(response, 404, { error: "team version not found; register it with POST /teams first" });
          const dataset = state.datasets.get(body.dataset_id, body.as_of);
          const experiment = await state.experiments.run({
            name: body.name, dataset, graph, evaluators: state.evaluators, evaluator_ids: body.evaluator_ids, split: body.split,
            runMission: (g, m) => runtime.run(g, m), onRun: (run) => state.runs.set(run.run_id, structuredClone(run)),
          });
          return send(response, 201, experiment);
        }
      }

      if (parts[0] === "queue") {
        if (parts.length === 1 && method === "GET") return send(response, 200, state.queue.list());
        if (!requireSession(request, response, state)) return;
        if (parts.length === 1 && method === "POST") {
          const body = await readJson<{ mission_id: string; run_at?: string; deployment_id?: string }>(request);
          if (!state.missions.has(body.mission_id)) return send(response, 404, { error: "mission not found; register it with POST /missions first" });
          if (body.deployment_id) state.deployments.get(body.deployment_id);
          return send(response, 201, state.queue.enqueue(body));
        }
        if (parts.length === 2 && parts[1] === "drain" && method === "POST") {
          const body = await readJson<{ max?: number }>(request);
          const done = [];
          for (const job of state.queue.takeDue(body.max ?? 10)) {
            try {
              const mission = state.missions.get(job.mission_id);
              if (!mission) throw new Error(`mission not found: ${job.mission_id}`);
              if (job.deployment_id) {
                const out = await runThroughDeployment(job.deployment_id, mission);
                if (!out.run) throw new Error(`blocked by policy: ${out.policy.decisions.filter((d) => !d.ok).map((d) => d.policy_id).join(", ")}`);
                done.push(state.queue.finish(job.job_id, { run_id: out.run.run_id, verdict: out.run.verdict }));
              } else {
                const graph = state.teams.get(state.teamKey(mission.team_id, mission.team_version));
                if (!graph) throw new Error(`team version not found: ${mission.team_id} v${mission.team_version}`);
                const run = await runtime.run(graph, mission);
                state.runs.set(run.run_id, structuredClone(run));
                done.push(state.queue.finish(job.job_id, { run_id: run.run_id, verdict: run.verdict }));
              }
            } catch (error) {
              done.push(state.queue.finish(job.job_id, { error: error instanceof Error ? error.message : String(error) }));
            }
          }
          return send(response, 200, done);
        }
        if (parts.length === 2 && method === "DELETE") return send(response, 200, state.queue.cancel(parts[1]));
      }

      if (parts[0] === "knowledge") {
        if (parts.length === 1 && method === "GET") return send(response, 200, state.knowledge.list());
        if (parts.length === 2 && method === "GET") return send(response, 200, state.knowledge.documents(parts[1]));
        if (parts.length === 3 && parts[2] === "search" && method === "POST") {
          const body = await readJson<{ query: string; k?: number }>(request);
          return send(response, 200, state.knowledge.search(parts[1], body.query, body.k));
        }
        if (parts.length === 4 && parts[2] === "documents" && method === "GET") return send(response, 200, state.knowledge.get(parts[1], parts[3]));
        if (parts.length === 3 && parts[2] === "documents" && method === "POST") {
          if (!requireSession(request, response, state)) return;
          return send(response, 201, state.knowledge.add(parts[1], await readJson<{ doc_id: string; title?: string; source?: string; text: string }>(request)));
        }
      }

      if (parts[0] === "policies") {
        if (parts.length === 1 && method === "GET") return send(response, 200, state.policies.list());
        if (!requireSession(request, response, state)) return;
        if (parts.length === 1 && method === "POST") return send(response, 201, state.policies.add(await readJson<PolicyInput>(request)));
        if (parts.length === 2 && parts[1] === "evaluate" && method === "POST") {
          const body = await readJson<{ team_id: string; version: string; mission?: Mission }>(request);
          const team = state.teams.get(state.teamKey(String(body.team_id), String(body.version)));
          if (!team) return send(response, 404, { error: "team version not found" });
          return send(response, 200, state.policies.evaluate(team, body.mission));
        }
        if (parts.length === 2 && method === "DELETE") { state.policies.remove(parts[1]); return send(response, 200, { removed: parts[1] }); }
      }

      if (parts[0] === "organizations" && parts.length === 1) {
        if (method === "GET") {
          const observed = [
            ...[...state.teams.values()].map((t) => ({ organization_id: t.organization_id, project_id: t.project_id })),
            ...[...state.missions.values()].map((m) => ({ organization_id: m.organization_id, project_id: m.project_id })),
            ...[...state.runs.values()].map((r) => ({ organization_id: r.proof.organization_id, project_id: r.proof.project_id })),
          ];
          return send(response, 200, state.organizations.list(observed));
        }
        if (method === "POST") {
          if (!requireSession(request, response, state)) return;
          return send(response, 201, state.organizations.register(await readJson<{ organization_id: string; name: string; projects?: string[] }>(request)));
        }
      }

      if (url.pathname === "/secrets" && method === "GET") {
        if (!requireSession(request, response, state)) return;
        return send(response, 200, secretStatus(process.env));
      }

      if (url.pathname === "/permissions" && method === "GET") {
        const session = authenticatedSession(request, state);
        return send(response, 200, { auth_mode: state.authMode, identity: session ? { identity_id: session.identity.identity_id, roles: session.identity.roles } : null, permissions: PERMISSIONS });
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
        const graph = state.teams.get(state.teamKey(mission.team_id, mission.team_version));
        if (!graph) return send(response, 404, { error: "team version not found" });
        await state.missionKernel.create(mission, graph);
        state.missions.set(mission.mission_id, structuredClone(mission));
        return send(response, 201, mission);
      }

      if (parts[0] === "missions" && parts.length >= 2 && parts.length <= 3) {
        const session = requireSession(request, response, state);
        if (!session) return;
        const record = await state.missionKernel.get(parts[1]);
        if (!record) return send(response, 404, { error: "mission not found" });
        if (method === "GET" && parts.length === 2) return send(response, 200, record);
        if (method === "GET" && parts[2] === "timeline") return send(response, 200, record.timeline);
        if (method === "GET" && parts[2] === "run") return record.run ? send(response, 200, record.run) : send(response, 404, { error: "mission has no run" });
        if (method === "GET" && parts[2] === "receipt") return record.mission_receipt ? send(response, 200, record.mission_receipt) : send(response, 404, { error: "mission has no receipt" });
        if (method === "POST" && parts[2] === "plan") return send(response, 200, await state.missionKernel.plan(parts[1], registry));
        if (method === "GET" && parts[2] === "plan") {
          if (!record.brain) return send(response, 404, { error: "mission has no accepted plan" });
          verifyBrainPlan(record);
          return send(response, 200, record.brain);
        }
        if (method === "POST" && parts[2] === "cancel") return send(response, 200, await state.missionKernel.cancel(parts[1]));
        if (method === "POST" && parts[2] === "run") {
          const run = await state.missionKernel.execute(parts[1], registry);
          state.runs.set(run.run_id, structuredClone(run));
          return send(response, 201, run);
        }
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
    if (error instanceof KnowledgeError || error instanceof ExperimentError) {
      return send(response, error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400, { error: message });
    }
    if (error instanceof ControlError) {
      const status = { not_found: 404, conflict: 409, forbidden: 403, invalid: 400 }[error.code];
      return send(response, status, { error: message });
    }
    if (error instanceof MissionConflictError) return send(response, 409, { error: message });
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
