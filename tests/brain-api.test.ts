import assert from "node:assert/strict";
import test from "node:test";
import { createServer, IncomingMessage, Server } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevExecution, DEV_BUILDER_REF, DEV_PLANNER_REF } from "../apps/api/src/server";
import { Mission, MissionRecord, TeamGraph } from "../packages/contracts/src";
import { FileMissionStore } from "../packages/runtime/src";
import { verifyCompletedMission } from "../packages/proof-core/src";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server): Promise<void> { await new Promise<void>((resolve) => server.close(() => resolve())); }
async function body(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("HTTP S2: NeurOSA context -> model gateway -> pinned plan -> restart -> agents -> proof/reflection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "osa-brain-api-"));
  const memoryRequests: Array<{ path: string; headers: IncomingMessage["headers"]; body?: unknown }> = [];
  const modelRequests: Array<{ system: string; input: Record<string, any> }> = [];
  const memoryText = "Untrusted historical project notes; require explicit checks.";
  const memory = createServer((req, res) => { void (async () => {
    const path = req.url!;
    memoryRequests.push({ path, headers: req.headers, ...(req.method === "POST" ? { body: await body(req) } : {}) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(path.endsWith("status") ? { brainId: "brain", ledgerValid: true } :
      { brainId: "brain", ledgerValid: true, ledgerHead: "ledger-head", text: memoryText, references: [{ documentId: "notes", revision: 1 }], truncated: false }));
  })(); });
  const provider = createServer((req, res) => { void (async () => {
    const data = await body(req);
    const system = data.messages[0].content as string, input = JSON.parse(data.messages[1].content);
    modelRequests.push({ system, input });
    const output = system.includes("cognitive planning control plane") ? {
      summary: "Implement with test evidence", goals: ["Implement app", "Test app"],
      tasks: input.tasks.map((task: { task_id: string; agent_id: string }) => ({ task_id: task.task_id, agent_id: task.agent_id, instruction: `Pinned instruction for ${task.agent_id}` })),
    } : system.includes("Produce a short, concrete plan") ? { summary: "Agent implementation plan", steps: ["Implement", "Test"] } : { title: "App", content: "Artifact content" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `response-${modelRequests.length}`, model: "test-brain", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  })(); });
  let api: Server | undefined;
  try {
    const memoryBase = await listen(memory), providerBase = await listen(provider);
    const env = { OSA_EXECUTION_MODE: "provider", OSA_PROVIDER: "openai", OSA_MODEL: "test-brain", OPENAI_API_KEY: "TEST_PROVIDER_SECRET",
      OSA_PROVIDER_BASE_URL: providerBase, OSA_PROVIDER_MAX_RETRIES: "0", OSA_BRAIN_MODE: "model",
      OSA_NEUROSA_BASE_URL: memoryBase, OSA_NEUROSA_TOKEN: "TEST_MEMORY_SECRET_TOKEN_123456", OSA_NEUROSA_BRAIN_ID: "brain", OSA_NEUROSA_ORGANIZATION_ID: "org", OSA_NEUROSA_PROJECT_ID: "project" };
    function makeApi(): Server {
      const execution = createDevExecution(env);
      return createApiServer(execution.registry, new ApiState(undefined, undefined, undefined, "session", new FileMissionStore(directory), execution.brain), execution.description);
    }
    async function login(base: string): Promise<Record<string, string>> {
      const res = await fetch(`${base}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: "S2 test" }) });
      const login = await res.json() as { session: { token: string } };
      return { "content-type": "application/json", authorization: `Bearer ${login.session.token}` };
    }
    api = makeApi(); let base = await listen(api), headers = await login(base);
    const post = (path: string, data: unknown) => fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(data) });
    const graph: TeamGraph = { organization_id: "org", project_id: "project", team_id: "team", version: "1",
      agents: [{ agent_id: "planner", role: "planner", executor_ref: DEV_PLANNER_REF }, { agent_id: "builder", role: "builder", executor_ref: DEV_BUILDER_REF }],
      edges: [{ edge_id: "handoff", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }] };
    const mission: Mission = { organization_id: "org", project_id: "project", mission_id: "mission", team_id: "team", team_version: "1", objective: "Build an app", entry_agent_id: "planner", input: {},
      budget: { max_tasks: 2, max_context_chars: 512 }, policy: { allowed_executor_refs: [DEV_PLANNER_REF, DEV_BUILDER_REF], allowed_model_refs: ["openai:test-brain"] },
      requirements: [{ requirement_id: "built", type: "evidence_field_equals", evidence_kind: "artifact", field: "status", expected: "built" }] };
    assert.equal((await post("/teams", graph)).status, 201);
    assert.equal((await post("/missions", mission)).status, 201);
    assert.equal((await fetch(`${base}/missions/mission/plan`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/missions/mission/plan`, { method: "POST" })).status, 401);
    assert.equal((await post("/missions/mission/plan", {})).status, 200);
    assert.equal(modelRequests.length, 1); assert.equal(memoryRequests.length, 2);
    assert.equal(modelRequests[0].input.mission_id, "mission");
    assert.equal(modelRequests[0].input.memory.text, memoryText);
    assert.equal(modelRequests[0].input.memory.untrusted, true);
    assert.deepEqual(memoryRequests.map((r) => r.path), ["/api/v1/brain/status", "/api/v1/brain/recall"]);
    assert.equal(memoryRequests[1].headers["x-neurosa-brain-id"], "brain");
    assert.equal(memoryRequests[1].headers["x-osa-mission-id"], "mission");
    assert.deepEqual(memoryRequests[1].body, { query: "Build an app", includeCore: true, maxChars: 512, limit: 10 });
    const pinned = await (await fetch(`${base}/missions/mission`, { headers })).json() as MissionRecord;
    await close(api); api = makeApi(); base = await listen(api); headers = await login(base);
    assert.equal((await post("/missions/mission/plan", {})).status, 200);
    assert.equal(modelRequests.length, 1); assert.equal(memoryRequests.length, 2);
    assert.equal((await post("/missions/mission/run", {})).status, 201);
    assert.equal(modelRequests.length, 3); assert.equal(memoryRequests.length, 2);
    assert.equal(modelRequests[1].input.pinned_plan_sha256, pinned.brain?.plan.plan_sha256);
    assert.equal(modelRequests[2].input.instruction, "Pinned instruction for builder");
    const completed = await (await fetch(`${base}/missions/mission`, { headers })).json() as MissionRecord;
    verifyCompletedMission(completed);
    assert.equal(completed.brain?.planning_receipt.evidence.source, "model_gateway");
    assert.equal(completed.brain?.memory?.ledger_head, "ledger-head");
    assert.equal(completed.mission_receipt?.reflection_sha256, completed.brain?.reflection?.reflection_sha256);
    assert.doesNotMatch(JSON.stringify(completed), /TEST_PROVIDER_SECRET|TEST_MEMORY_SECRET/);
    assert.equal((await fetch(`${base}/missions/mission/plan`, { headers })).status, 200);
    assert.equal((await post("/missions/mission/run", {})).status, 201);
    assert.equal(modelRequests.length, 3);
  } finally {
    if (api) await close(api);
    await close(memory); await close(provider); await rm(directory, { recursive: true, force: true });
  }
});

test("NeurOSA adapter aborts a stalled real HTTP request within its configured timeout", async () => {
  const server = createServer((_req, _res) => { /* no response */ });
  try {
    const base = await listen(server);
    const adapter = new NeurosaMemoryAdapter({ baseUrl: base, token: "x".repeat(24), brainId: "brain", organizationId: "org", projectId: "project", timeoutMs: 30 });
    await assert.rejects(adapter.recall({ organization_id: "org", project_id: "project", mission_id: "mission" }, "objective", 512), /NEUROSA_UNAVAILABLE/);
  } finally { server.closeAllConnections(); await close(server); }
});
