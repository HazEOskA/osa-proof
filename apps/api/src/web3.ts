import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiState } from "./index";
import type { SessionRecord, Web3Scope } from "../../../packages/contracts/src";
import { ExecutorRegistry } from "../../../packages/runtime/src";
import { verifyCompletedMission, digest } from "../../../packages/proof-core/src";
import { assertScope, createIntent, evaluatePolicy, object, projectEvidence, READ_FIRST_POLICY, safeMetadata, text, Web3Error, web3ReadMission, web3ReadTeam } from "../../../packages/web3/src";
function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const b = Buffer.from(chunk); size += b.length; if (size > 65536) throw new Web3Error("WEB3_REQUEST_TOO_LARGE", 413); chunks.push(b); }
  try { return safeMetadata(object(JSON.parse(Buffer.concat(chunks).toString("utf8")))); } catch (e) { if (e instanceof Web3Error) throw e; throw new Web3Error("WEB3_JSON_INVALID"); }
}
function scopeFor(session: SessionRecord, mission_id: string, project_id = "project_web3_local"): Web3Scope {
  // v0.1 exposes one development project. Existing local-dev sessions have no authoritative project grants.
  if (project_id !== "project_web3_local") throw new Web3Error("WEB3_PROJECT_DENIED", 403);
  const scope = { organization_id: text(session.identity.organization_id), project_id, mission_id }; assertScope(scope); return scope;
}
export async function handleWeb3Request(request: IncomingMessage, response: ServerResponse, state: ApiState, registry: ExecutorRegistry, session: SessionRecord): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost"); const method = request.method ?? "GET"; const parts = url.pathname.split("/").filter(Boolean);
    if (method === "GET" && url.pathname === "/web3/status") return send(response,200,{ ...state.web3.describe(), authMode: state.authMode, organization_id: session.identity.organization_id, approvalEnabled: false, defaultProject: "project_web3_local" });
    if (method === "POST" && url.pathname === "/web3/observe") {
      if (!session.identity.roles.includes("developer")) throw new Web3Error("WEB3_PERMISSION_DENIED",403);
      const body = await readBody(request); const scope = scopeFor(session,text(body.mission_id),body.project_id === undefined ? undefined : text(body.project_id));
      if (body.organization_id !== undefined && body.organization_id !== scope.organization_id) throw new Web3Error("WEB3_SCOPE_DENIED",403);
      const input = safeMetadata(object(body.input)); const team = web3ReadTeam(scope.organization_id,scope.project_id); const mission = web3ReadMission(scope.mission_id,team,input);
      const existing = await state.missionKernel.get(scope.mission_id);
      if (existing && (digest(existing.mission) !== digest(mission) || digest(existing.team) !== digest(team))) throw new Web3Error("WEB3_MISSION_CONFLICT",409);
      if (!state.web3.adapter) throw new Web3Error("WEB3_RPC_NOT_CONFIGURED",503);
      state.web3.authorize(mission,team);
      if (!existing) await state.missionKernel.create(mission,team);
      const run = await state.missionKernel.execute(scope.mission_id,registry);
      state.runs.set(run.run_id,structuredClone(run));
      const record = await state.missionKernel.get(scope.mission_id);
      const world = run.verdict === "VERIFIED" ? projectEvidence(run.evidence,scope) : null;
      if (world) state.web3.events.replay(world.events,run.execution_id);
      return send(response,200,{ mission_id: scope.mission_id, state: record?.state, run, world });
    }
    if (method === "GET" && parts[1] === "missions" && parts.length === 3) {
      const scope = scopeFor(session,decodeURIComponent(parts[2])); const record = await state.missionKernel.get(scope.mission_id);
      if (!record) throw new Web3Error("WEB3_MISSION_NOT_FOUND",404);
      if (record.mission.organization_id !== scope.organization_id || record.mission.project_id !== scope.project_id || record.mission.team_id !== "web3_read") throw new Web3Error("WEB3_SCOPE_DENIED",403);
      if (record.state === "COMPLETED") verifyCompletedMission(record);
      const world = record.state === "COMPLETED" && record.run ? projectEvidence(record.run.evidence,scope) : null;
      if (world && record.run) state.web3.events.replay(world.events,record.run.execution_id);
      return send(response,200,{ record,world });
    }
    if (method === "POST" && url.pathname === "/web3/intents/preview") {
      const body = await readBody(request); const scope = scopeFor(session,text(body.mission_id));
      const intent = createIntent(body.intent,scope);
      const policy = evaluatePolicy(intent,READ_FIRST_POLICY,{ ...scope,agentIds: [],permissions: [] },0);
      return send(response,200,{ intent: { ...intent, policyResult: policy }, policy, executed: false, approvalEnabled: false, persistence: "NOT_SAVED_PREVIEW" });
    }
    if (method !== "GET") throw new Web3Error("WEB3_WRITE_UNSUPPORTED_V01",409);
    throw new Web3Error("WEB3_ROUTE_NOT_FOUND",404);
  } catch (error) {
    if (error instanceof Web3Error) return send(response,error.status,{ error: error.code });
    // Never expose raw RPC endpoints, transport errors, keys or executor-provided exception text.
    return send(response,500,{ error: "WEB3_REQUEST_FAILED" });
  }
}
