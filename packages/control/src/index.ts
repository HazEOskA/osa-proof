import { Mission, TeamGraph } from "../../contracts/src";
import { CanonicalizationError, digest } from "../../proof-core/src";
import { validateTeamGraph } from "../../team-graph/src";

// Control plane for OSA: deployments of Team Graph versions, policies checked before a deployment runs,
// organizations, secret status and the permission table. State is process memory, like runs; every record
// that matters is content-addressed so a copy can be checked against its digest.

export class ControlError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "conflict" | "forbidden" = "invalid") {
    super(message);
    this.name = "ControlError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new ControlError(`${field} must match ${ID.source}`);
  return value;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ── Deployments ─────────────────────────────────────────────────────────────────────────────────────────
// A deployment pins one Team Graph version to an environment. Only one deployment per team and environment
// is ACTIVE; deploying again supersedes it, rollback reactivates the one it replaced. Runs through a
// deployment always use the pinned graph, whatever the mission says.

export const ENVIRONMENTS = ["preview", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export type DeploymentStatus = "ACTIVE" | "SUPERSEDED" | "ROLLED_BACK";

export interface Deployment {
  deployment_id: string;
  team_id: string;
  team_version: string;
  environment: Environment;
  graph_sha256: string;
  status: DeploymentStatus;
  replaces: string | null;
  note: string;
  created_at: string;
  graph: TeamGraph;
}

export function verifyDeployment(deployment: Deployment): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let sha: string | null = null;
  try { sha = digest(deployment.graph); } catch { sha = null; }
  if (sha !== deployment.graph_sha256) errors.push("graph does not match graph_sha256");
  if (deployment.graph.team_id !== deployment.team_id || deployment.graph.version !== deployment.team_version) errors.push("graph is not the deployed team version");
  return { ok: errors.length === 0, errors };
}

export class DeploymentStore {
  private readonly deployments: Deployment[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  deploy(params: { team: TeamGraph; environment: string; note?: string }): Deployment {
    const environment = params.environment as Environment;
    if (!ENVIRONMENTS.includes(environment)) throw new ControlError(`environment must be one of ${ENVIRONMENTS.join(", ")}`);
    try { validateTeamGraph(params.team); } catch (error) { throw new ControlError(error instanceof Error ? error.message : String(error)); }
    let graphSha: string;
    try { graphSha = digest(params.team); } catch (error) {
      if (error instanceof CanonicalizationError) throw new ControlError(error.message);
      throw error;
    }
    const current = this.active(params.team.team_id, environment);
    if (current && current.graph_sha256 === graphSha) throw new ControlError(`this exact graph is already active in ${environment}`, "conflict");
    const createdAt = this.clock().toISOString();
    const deploymentId = `dep_${digest({ graphSha, environment, createdAt, n: this.deployments.length }).slice(0, 20)}`;
    if (current) this.setStatus(current.deployment_id, "SUPERSEDED");
    const deployment = deepFreeze<Deployment>({
      deployment_id: deploymentId, team_id: params.team.team_id, team_version: params.team.version, environment,
      graph_sha256: graphSha, status: "ACTIVE", replaces: current?.deployment_id ?? null, note: String(params.note ?? ""),
      created_at: createdAt, graph: structuredClone(params.team),
    });
    this.deployments.push(deployment);
    return structuredClone(deployment);
  }

  // Reactivates the deployment the active one replaced.
  rollback(teamId: string, environment: string): Deployment {
    const current = this.active(teamId, environment as Environment);
    if (!current) throw new ControlError(`no active deployment of ${teamId} in ${environment}`, "not_found");
    if (!current.replaces) throw new ControlError(`${current.deployment_id} has nothing to roll back to`, "conflict");
    this.setStatus(current.deployment_id, "ROLLED_BACK");
    this.setStatus(current.replaces, "ACTIVE");
    return this.get(current.replaces);
  }

  // Deploys the exact graph of a preview deployment to production.
  promote(deploymentId: string, note?: string): Deployment {
    const source = this.get(deploymentId);
    if (source.environment !== "preview") throw new ControlError("only preview deployments can be promoted", "conflict");
    return this.deploy({ team: source.graph, environment: "production", note: note ?? `promoted from ${deploymentId}` });
  }

  get(deploymentId: string): Deployment {
    const found = this.deployments.find((d) => d.deployment_id === deploymentId);
    if (!found) throw new ControlError(`deployment not found: ${deploymentId}`, "not_found");
    return structuredClone(found);
  }

  active(teamId: string, environment: Environment): Deployment | undefined {
    const found = this.deployments.find((d) => d.team_id === teamId && d.environment === environment && d.status === "ACTIVE");
    return found ? structuredClone(found) : undefined;
  }

  list(): Deployment[] {
    return this.deployments.map((d) => structuredClone(d)).reverse();
  }

  private setStatus(deploymentId: string, status: DeploymentStatus): void {
    const index = this.deployments.findIndex((d) => d.deployment_id === deploymentId);
    const next = deepFreeze({ ...structuredClone(this.deployments[index]), status });
    this.deployments[index] = next;
  }
}

// ── Policies ────────────────────────────────────────────────────────────────────────────────────────────
// Declarative rules evaluated against a Team Graph and a mission before a deployment runs it. Unknown rule
// types are refused when the policy is added. Any enabled policy that fails blocks the run (fail closed).

export type PolicyRule =
  | { type: "max_agents"; max: number }
  | { type: "allowed_executor_refs"; refs: string[] }
  | { type: "min_requirements"; min: number }
  | { type: "forbidden_roles"; roles: string[] };

export interface PolicyInput { policy_id: string; description?: string; rule: PolicyRule; enabled?: boolean }
export interface Policy { policy_id: string; description: string; rule: PolicyRule; enabled: boolean; policy_sha256: string }
export interface PolicyDecision { policy_id: string; policy_sha256: string; ok: boolean; reason: string }
export interface PolicyEvaluation { allowed: boolean; decisions: PolicyDecision[]; evaluation_sha256: string }

function validateRule(rule: PolicyRule): void {
  if (!rule || typeof rule !== "object") throw new ControlError("rule is required");
  switch (rule.type) {
    case "max_agents": if (!Number.isInteger(rule.max) || rule.max < 1) throw new ControlError("max_agents.max must be a positive integer"); return;
    case "min_requirements": if (!Number.isInteger(rule.min) || rule.min < 1) throw new ControlError("min_requirements.min must be a positive integer"); return;
    case "allowed_executor_refs":
      if (!Array.isArray(rule.refs) || rule.refs.length === 0 || rule.refs.some((r) => typeof r !== "string" || !r)) throw new ControlError("allowed_executor_refs.refs must list executor refs");
      return;
    case "forbidden_roles":
      if (!Array.isArray(rule.roles) || rule.roles.length === 0 || rule.roles.some((r) => typeof r !== "string" || !r)) throw new ControlError("forbidden_roles.roles must list roles");
      return;
    default: throw new ControlError(`unknown policy rule type: ${(rule as { type?: unknown }).type}`);
  }
}

function decide(rule: PolicyRule, graph: TeamGraph, mission?: Mission): { ok: boolean; reason: string } {
  switch (rule.type) {
    case "max_agents": return graph.agents.length <= rule.max
      ? { ok: true, reason: `${graph.agents.length} agents ≤ ${rule.max}` } : { ok: false, reason: `${graph.agents.length} agents > ${rule.max}` };
    case "allowed_executor_refs": {
      const bad = graph.agents.filter((a) => !rule.refs.includes(a.executor_ref)).map((a) => `${a.agent_id}:${a.executor_ref}`);
      return bad.length ? { ok: false, reason: `executor refs not allowed: ${bad.join(", ")}` } : { ok: true, reason: "every executor ref is allowed" };
    }
    case "forbidden_roles": {
      const bad = graph.agents.filter((a) => rule.roles.includes(a.role)).map((a) => `${a.agent_id}:${a.role}`);
      return bad.length ? { ok: false, reason: `forbidden roles: ${bad.join(", ")}` } : { ok: true, reason: "no forbidden role" };
    }
    case "min_requirements": {
      if (!mission) return { ok: false, reason: "no mission to check requirements against" };
      const n = mission.requirements.length;
      return n >= rule.min ? { ok: true, reason: `${n} requirements ≥ ${rule.min}` } : { ok: false, reason: `${n} requirements < ${rule.min}` };
    }
  }
}

export class PolicyStore {
  private readonly policies = new Map<string, Policy>();

  add(input: PolicyInput): Policy {
    const policyId = requireId(input?.policy_id, "policy_id");
    validateRule(input.rule);
    const body = { policy_id: policyId, description: String(input.description ?? ""), rule: structuredClone(input.rule), enabled: input.enabled !== false };
    const policy = deepFreeze<Policy>({ ...body, policy_sha256: digest(body) });
    const existing = this.policies.get(policyId);
    if (existing && existing.policy_sha256 !== policy.policy_sha256) throw new ControlError(`policy ${policyId} exists with different content; remove it first`, "conflict");
    this.policies.set(policyId, policy);
    return structuredClone(policy);
  }

  remove(policyId: string): void {
    if (!this.policies.delete(policyId)) throw new ControlError(`policy not found: ${policyId}`, "not_found");
  }

  list(): Policy[] {
    return [...this.policies.values()].map((p) => structuredClone(p)).sort((a, b) => (a.policy_id < b.policy_id ? -1 : 1));
  }

  evaluate(graph: TeamGraph, mission?: Mission): PolicyEvaluation {
    const decisions = this.list().filter((p) => p.enabled).map((p) => ({ policy_id: p.policy_id, policy_sha256: p.policy_sha256, ...decide(p.rule, graph, mission) }));
    const body = { graph_sha256: digest(graph), mission_id: mission?.mission_id ?? null, decisions };
    return { allowed: decisions.every((d) => d.ok), decisions, evaluation_sha256: digest(body) };
  }
}

// ── Organizations ───────────────────────────────────────────────────────────────────────────────────────
export interface OrganizationRecord { organization_id: string; name: string; source: "registered" | "observed"; projects: string[] }

export class OrganizationStore {
  private readonly registered = new Map<string, { name: string; projects: Set<string> }>();

  register(params: { organization_id: string; name: string; projects?: string[] }): OrganizationRecord {
    const id = requireId(params?.organization_id, "organization_id");
    if (typeof params.name !== "string" || !params.name.trim()) throw new ControlError("name is required");
    if (this.registered.has(id)) throw new ControlError(`organization already registered: ${id}`, "conflict");
    const projects = new Set((params.projects ?? []).map((p) => requireId(p, "projects[]")));
    this.registered.set(id, { name: params.name.trim(), projects });
    return { organization_id: id, name: params.name.trim(), source: "registered", projects: [...projects].sort() };
  }

  // Registered organizations plus every organization and project seen in teams, missions and runs.
  list(observed: Array<{ organization_id: string; project_id: string }>): OrganizationRecord[] {
    const all = new Map<string, OrganizationRecord>();
    for (const [id, org] of this.registered) all.set(id, { organization_id: id, name: org.name, source: "registered", projects: [...org.projects] });
    for (const o of observed) {
      const record = all.get(o.organization_id) ?? { organization_id: o.organization_id, name: o.organization_id, source: "observed" as const, projects: [] };
      if (!record.projects.includes(o.project_id)) record.projects.push(o.project_id);
      all.set(o.organization_id, record);
    }
    return [...all.values()].map((r) => ({ ...r, projects: [...r.projects].sort() })).sort((a, b) => (a.organization_id < b.organization_id ? -1 : 1));
  }
}

// ── Secrets ─────────────────────────────────────────────────────────────────────────────────────────────
// Only names and whether they are set. Never a value, a length, a prefix or a hash of a value.
export const KNOWN_SECRETS: ReadonlyArray<{ name: string; used_by: string }> = [
  { name: "ANTHROPIC_API_KEY", used_by: "llm-gateway (OSA_PROVIDER=anthropic)" },
  { name: "OPENAI_API_KEY", used_by: "llm-gateway (OSA_PROVIDER=openai)" },
];
export function secretStatus(env: Record<string, string | undefined>): Array<{ name: string; set: boolean; used_by: string }> {
  return KNOWN_SECRETS.map((s) => ({ name: s.name, set: typeof env[s.name] === "string" && env[s.name]!.length > 0, used_by: s.used_by }));
}

// ── Permissions ─────────────────────────────────────────────────────────────────────────────────────────
// What the API enforces today, route by route. "session" means a DEV session is required when
// OSA_AUTH_MODE=session; tests/control.test.ts checks every "session" row returns 401 without a token.
export interface PermissionRow { permission: string; method: string; path: string; enforced: "session" | "public" }
export const PERMISSIONS: ReadonlyArray<PermissionRow> = [
  { permission: "teams.write", method: "POST", path: "/teams", enforced: "session" },
  { permission: "teams.read", method: "GET", path: "/teams/:id?version=", enforced: "session" },
  { permission: "missions.write", method: "POST", path: "/missions", enforced: "session" },
  { permission: "missions.run", method: "POST", path: "/missions/:id/run", enforced: "session" },
  { permission: "runs.read", method: "GET", path: "/runs/:id", enforced: "session" },
  { permission: "evaluations.write", method: "POST", path: "/runs/:id/evaluations", enforced: "session" },
  { permission: "workspace.write", method: "POST", path: "/build/workspace", enforced: "session" },
  { permission: "deployments.write", method: "POST", path: "/deployments", enforced: "session" },
  { permission: "deployments.run", method: "POST", path: "/deployments/:id/run", enforced: "session" },
  { permission: "policies.write", method: "POST", path: "/policies", enforced: "session" },
  { permission: "organizations.write", method: "POST", path: "/organizations", enforced: "session" },
  { permission: "secrets.read", method: "GET", path: "/secrets", enforced: "session" },
  { permission: "experiments.run", method: "POST", path: "/experiments", enforced: "session" },
  { permission: "queue.write", method: "POST", path: "/queue", enforced: "session" },
  { permission: "queue.drain", method: "POST", path: "/queue/drain", enforced: "session" },
  { permission: "knowledge.write", method: "POST", path: "/knowledge/:id/documents", enforced: "session" },
  { permission: "layers.read", method: "GET", path: "/layers", enforced: "public" },
  { permission: "intelligence.read", method: "GET", path: "/intelligence", enforced: "public" },
  { permission: "datasets.write", method: "POST", path: "/datasets", enforced: "public" },
  { permission: "evaluators.write", method: "POST", path: "/evaluators", enforced: "public" },
];


// ── Queue and scheduler ─────────────────────────────────────────────────────────────────────────────────
// Missions queued to run now or at run_at. There is no background worker in a serverless function, so due
// jobs run when POST /queue/drain is called (a cron can call it). Each finished job keeps its run_id and
// verdict, so it points at a sealed receipt.
export type JobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";
export interface Job {
  job_id: string; mission_id: string; deployment_id: string | null; run_at: string; created_at: string;
  status: JobStatus; run_id: string | null; verdict: string | null; error: string | null;
}

export class JobQueue {
  private readonly jobs: Job[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  enqueue(params: { mission_id: string; run_at?: string; deployment_id?: string }): Job {
    if (typeof params?.mission_id !== "string" || !params.mission_id) throw new ControlError("mission_id is required");
    const now = this.clock();
    let runAt = now;
    if (params.run_at !== undefined) {
      runAt = new Date(params.run_at);
      if (Number.isNaN(runAt.getTime())) throw new ControlError("run_at must be an ISO timestamp");
    }
    const job: Job = {
      job_id: `job_${digest({ m: params.mission_id, d: params.deployment_id ?? null, at: runAt.toISOString(), c: now.toISOString(), n: this.jobs.length }).slice(0, 16)}`,
      mission_id: params.mission_id, deployment_id: params.deployment_id ?? null, run_at: runAt.toISOString(), created_at: now.toISOString(),
      status: "QUEUED", run_id: null, verdict: null, error: null,
    };
    this.jobs.push(job);
    return structuredClone(job);
  }

  // Due jobs in run_at order, marked RUNNING so a second drain does not pick them up.
  takeDue(max = 10): Job[] {
    const now = this.clock().getTime();
    const due = this.jobs.filter((j) => j.status === "QUEUED" && new Date(j.run_at).getTime() <= now)
      .sort((a, b) => (a.run_at < b.run_at ? -1 : a.run_at > b.run_at ? 1 : 0)).slice(0, Math.max(1, Math.min(max, 50)));
    for (const j of due) j.status = "RUNNING";
    return due.map((j) => structuredClone(j));
  }

  finish(jobId: string, outcome: { run_id: string; verdict: string } | { error: string }): Job {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) throw new ControlError(`job not found: ${jobId}`, "not_found");
    if ("error" in outcome) { job.status = "FAILED"; job.error = outcome.error; } else { job.status = "DONE"; job.run_id = outcome.run_id; job.verdict = outcome.verdict; }
    return structuredClone(job);
  }

  cancel(jobId: string): Job {
    const index = this.jobs.findIndex((j) => j.job_id === jobId);
    if (index < 0) throw new ControlError(`job not found: ${jobId}`, "not_found");
    if (this.jobs[index].status !== "QUEUED") throw new ControlError(`only QUEUED jobs can be cancelled; ${jobId} is ${this.jobs[index].status}`, "conflict");
    const [job] = this.jobs.splice(index, 1);
    return structuredClone(job);
  }

  list(): Job[] {
    return this.jobs.map((j) => structuredClone(j)).reverse();
  }
}
