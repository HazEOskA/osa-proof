import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createDevExecution, DEV_BUILDER_REF, DEV_PLANNER_REF } from "../apps/api/src/server";
import { loadMeshConfig, MAX_MODEL_FALLBACKS, ModelMesh, ProviderCallError, ProviderConfigError } from "../packages/adapters/src";
import { Mission, RunResult, TeamGraph } from "../packages/contracts/src";
import { verifyProofReceipt } from "../packages/proof-core/src";
import { OsaRuntime } from "../packages/runtime/src";

const OPENAI_SECRET = "sk-mesh-openai-SECRET-1";
const ANTHROPIC_SECRET = "sk-mesh-anthropic-SECRET-2";

const graph: TeamGraph = {
  organization_id: "org_mesh", project_id: "project_mesh", team_id: "team_mesh", version: "1",
  agents: [
    { agent_id: "planner", role: "planner", executor_ref: DEV_PLANNER_REF },
    { agent_id: "builder", role: "builder", executor_ref: DEV_BUILDER_REF },
  ],
  edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
};
const mission: Mission = {
  organization_id: "org_mesh", project_id: "project_mesh", mission_id: "mission_mesh", team_id: "team_mesh", team_version: "1",
  objective: "Draft release notes", entry_agent_id: "planner", input: { request: "Draft release notes" },
  requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
};

const PLAN = JSON.stringify({ summary: "two steps", steps: ["collect", "write"] });
const ARTIFACT = JSON.stringify({ title: "Release notes", content: "Slice 2 seals receipts." });
const anthropicOk = (text: string) => ({ status: 200, body: { id: "msg", model: "claude-backup", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } });
const openaiOk = (text: string) => ({ status: 200, body: { id: "c", model: "gpt-primary", choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
const down = { status: 503, body: { error: { type: "overloaded" } } };

type Reply = { status: number; body: unknown };
// One stub for both providers, routed by path, each with its own reply queue.
async function startStub(routes: { openai?: Reply[]; anthropic?: Reply[] }) {
  const hits = { openai: 0, anthropic: 0 };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    for await (const _ of req) { /* drain */ }
    const key = req.url === "/v1/chat/completions" ? "openai" : "anthropic";
    hits[key] += 1;
    const reply = routes[key]?.shift() ?? down;
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

function meshEnv(base: string, extra: Record<string, string | undefined> = {}) {
  return {
    OSA_EXECUTION_MODE: "provider", OSA_PROVIDER: "openai", OSA_MODEL: "gpt-primary",
    OPENAI_API_KEY: OPENAI_SECRET, ANTHROPIC_API_KEY: ANTHROPIC_SECRET,
    OSA_MODEL_FALLBACKS: "anthropic:claude-backup",
    OSA_PROVIDER_BASE_URL: base, OSA_PROVIDER_MAX_RETRIES: "1", OSA_PROVIDER_RETRY_BASE_MS: "1", ...extra,
  };
}

async function run(routes: { openai?: Reply[]; anthropic?: Reply[] }, extra: Record<string, string | undefined> = {}): Promise<{ result: RunResult; hits: { openai: number; anthropic: number } }> {
  const stub = await startStub(routes);
  try {
    const result = await new OsaRuntime(createDevExecution(meshEnv(stub.base, extra)).registry).run(graph, mission);
    return { result, hits: stub.hits };
  } finally {
    await stub.close();
  }
}

test("mesh: primary down after its retries, fallback serves, run VERIFIED with every hop in evidence", async () => {
  const { result, hits } = await run({ openai: [down, down, down, down], anthropic: [anthropicOk(PLAN), anthropicOk(ARTIFACT)] });
  assert.equal(result.verdict, "VERIFIED", JSON.stringify(result.proof.requirement_verdicts));
  assert.equal(hits.openai, 4, "primary gets 1 attempt + 1 retry per step (2 steps)");
  assert.equal(hits.anthropic, 2);
  for (const call of result.evidence.filter((e) => e.kind === "provider_call")) {
    assert.equal(call.data.provider, "anthropic");
    assert.deepEqual(call.data.hops, [
      { provider: "openai", model: "gpt-primary", ok: false, attempts: 2, error: "openai failed after 2 attempts: openai HTTP 503 (overloaded); openai HTTP 503 (overloaded)" },
      { provider: "anthropic", model: "claude-backup", ok: true, attempts: 1 },
    ]);
  }
  assert.deepEqual(verifyProofReceipt({ receipt: result.proof, evidence: result.evidence, observations: result.observations, final_output: result.final_output }), { ok: true, errors: [] });
  const text = JSON.stringify(result);
  assert.ok(!text.includes(OPENAI_SECRET) && !text.includes(ANTHROPIC_SECRET));
});

test("mesh: healthy primary serves alone; fallback untouched", async () => {
  const { result, hits } = await run({ openai: [openaiOk(PLAN), openaiOk(ARTIFACT)] });
  assert.equal(result.verdict, "VERIFIED");
  assert.equal(hits.anthropic, 0);
  const call = result.evidence.find((e) => e.kind === "provider_call")!;
  assert.deepEqual(call.data.hops, [{ provider: "openai", model: "gpt-primary", ok: true, attempts: 1 }]);
});

test("mesh: every target down -> FAILED, sealed receipt names each hop", async () => {
  const { result, hits } = await run({});
  assert.equal(result.verdict, "FAILED");
  assert.equal(hits.openai, 2);
  assert.equal(hits.anthropic, 2);
  const reason = result.proof.requirement_verdicts.at(-1)!.reason;
  assert.match(reason, /^model mesh exhausted 2 targets: openai\/gpt-primary: openai failed after 2 attempts: .* \| anthropic\/claude-backup: anthropic failed after 2 attempts: /);
  assert.equal(result.proof.runtime_failure, reason);
});

test("mesh: no fallbacks configured keeps the single-provider path (no hops field)", async () => {
  const { result } = await run({ openai: [openaiOk(PLAN), openaiOk(ARTIFACT)] }, { OSA_MODEL_FALLBACKS: undefined });
  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.evidence.find((e) => e.kind === "provider_call")!.data.hops, undefined);
});

test("mesh config fails closed", () => {
  const base = { OSA_PROVIDER: "openai", OSA_MODEL: "gpt-primary", OPENAI_API_KEY: "k" };
  assert.throws(() => loadMeshConfig({ ...base, OSA_MODEL_FALLBACKS: "anthropic:claude" }), (e: unknown) => e instanceof ProviderConfigError && /ANTHROPIC_API_KEY/.test(e.message));
  assert.throws(() => loadMeshConfig({ ...base, OSA_MODEL_FALLBACKS: "anthropic" }), /provider:model/);
  assert.throws(() => loadMeshConfig({ ...base, OSA_MODEL_FALLBACKS: ":model" }), /provider:model/);
  assert.throws(() => loadMeshConfig({ ...base, OSA_MODEL_FALLBACKS: "openai:gpt-primary" }), /repeats/);
  assert.throws(() => loadMeshConfig({ ...base, OSA_MODEL_FALLBACKS: "cohere:x" }), /OSA_PROVIDER must be one of/);
  const many = Array.from({ length: MAX_MODEL_FALLBACKS + 1 }, (_, i) => `openai:m${i}`).join(",");
  assert.throws(() => loadMeshConfig({ ...base, OSA_MODEL_FALLBACKS: many }), /at most 4/);
  const ok = loadMeshConfig({ ...base, ANTHROPIC_API_KEY: "a", OSA_MODEL_FALLBACKS: " anthropic:claude , openai:gpt-mini " });
  assert.deepEqual(ok.map((t) => `${t.provider}:${t.model}`), ["openai:gpt-primary", "anthropic:claude", "openai:gpt-mini"]);
});

test("mesh: startup description lists fallbacks without secrets", () => {
  const execution = createDevExecution(meshEnv("http://127.0.0.1:1"));
  assert.deepEqual(execution.description, { mode: "provider", provider: "openai", model: "gpt-primary", fallbacks: ["anthropic:claude-backup"] });
});

test("mesh: programming errors are not swallowed by fallback", async () => {
  const mesh = new ModelMesh([
    { id: "bug", model: "m", complete: async () => { throw new TypeError("bug"); } },
    { id: "ok", model: "m", complete: async () => { throw new ProviderCallError("never reached"); } },
  ]);
  await assert.rejects(mesh.complete({ system: "", prompt: "", output_schema: {} }), TypeError);
  assert.throws(() => new ModelMesh([]), RangeError);
});
