import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createDevExecution, DEV_BUILDER_REF, DEV_PLANNER_REF } from "../apps/api/src/server";
import {
  isRetryableStatus,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderCallError,
  ProviderConfigError,
  retryAfterMs,
  retryDelayMs,
  RetryingProvider,
} from "../packages/adapters/src";
import { Mission, RunResult, TeamGraph } from "../packages/contracts/src";
import { OsaRuntime } from "../packages/runtime/src";

const SECRET = "sk-openai-test-SECRET-91b2";

const graph: TeamGraph = {
  organization_id: "org_gw", project_id: "project_gw", team_id: "team_gw", version: "1",
  agents: [
    { agent_id: "planner", role: "planner", executor_ref: DEV_PLANNER_REF },
    { agent_id: "builder", role: "builder", executor_ref: DEV_BUILDER_REF },
  ],
  edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
};

const mission: Mission = {
  organization_id: "org_gw", project_id: "project_gw", mission_id: "mission_gw", team_id: "team_gw", team_version: "1",
  objective: "Summarize the proof protocol", entry_agent_id: "planner", input: { request: "Summarize the proof protocol" },
  requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
};

type Reply = { status?: number; body: unknown; headers?: Record<string, string>; delay_ms?: number };
interface Stub { base: string; requests: Array<{ url: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }>; close(): Promise<void> }

async function startStub(replies: Reply[], fallback: Reply = { status: 500, body: { error: { type: "server_error" } } }): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const queue = [...replies];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ url: request.url ?? "", headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    const reply = queue.shift() ?? fallback;
    if (reply.delay_ms) await new Promise((resolve) => setTimeout(resolve, reply.delay_ms));
    if (response.destroyed) return;
    response.writeHead(reply.status ?? 200, { "content-type": "application/json", ...(reply.headers ?? {}) });
    response.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const PLAN = JSON.stringify({ summary: "two steps", steps: ["read", "summarize"] });
const ARTIFACT = JSON.stringify({ title: "Proof protocol", content: "Claims are not proof; receipts are." });

function openaiReply(text: string, finish = "stop"): Reply {
  return { body: { id: "chatcmpl-1", object: "chat.completion", model: "gpt-test", choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: text } }], usage: { prompt_tokens: 11, completion_tokens: 7 } } };
}
function anthropicReply(text: string): Reply {
  return { body: { id: "msg_1", type: "message", model: "claude-test", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } } };
}

function env(provider: "openai" | "anthropic", base: string, extra: Record<string, string> = {}) {
  return {
    OSA_EXECUTION_MODE: "provider", OSA_PROVIDER: provider, OSA_MODEL: `${provider}-test-model`,
    [provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"]: SECRET,
    OSA_PROVIDER_BASE_URL: base, OSA_PROVIDER_TIMEOUT_MS: "2000", OSA_PROVIDER_RETRY_BASE_MS: "1", ...extra,
  };
}

async function run(provider: "openai" | "anthropic", replies: Reply[], extra: Record<string, string> = {}, fallback?: Reply): Promise<{ result: RunResult; stub: Stub }> {
  const stub = await startStub(replies, fallback);
  try {
    const result = await new OsaRuntime(createDevExecution(env(provider, stub.base, extra)).registry).run(graph, mission);
    return { result, stub };
  } finally {
    await stub.close();
  }
}

test("routing: OSA_PROVIDER=openai runs the team end to end and seals VERIFIED", async () => {
  const { result, stub } = await run("openai", [openaiReply(PLAN), openaiReply(ARTIFACT)]);
  assert.equal(result.verdict, "VERIFIED", JSON.stringify(result.proof.requirement_verdicts));
  assert.equal(stub.requests.length, 2);
  for (const req of stub.requests) {
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(req.body.model, "openai-test-model");
    assert.equal(typeof req.body.max_completion_tokens, "number");
    const format = req.body.response_format as { type: string; json_schema: { strict: boolean; schema: unknown } };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    assert.ok(format.json_schema.schema);
  }
  const call = result.evidence.find((e) => e.kind === "provider_call" && e.agent_id === "builder")!;
  assert.equal(call.data.provider, "openai");
  assert.equal(call.data.attempts, 1);
  assert.deepEqual(call.data.usage, { input_tokens: 11, output_tokens: 7 });
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("routing: openai requires OPENAI_API_KEY; unknown providers are refused", () => {
  assert.throws(() => createDevExecution({ OSA_EXECUTION_MODE: "provider", OSA_PROVIDER: "openai", OSA_MODEL: "m" }), (e: unknown) => e instanceof ProviderConfigError && /OPENAI_API_KEY/.test(e.message));
  assert.throws(() => createDevExecution({ OSA_EXECUTION_MODE: "provider", OSA_PROVIDER: "cohere", OSA_MODEL: "m", OPENAI_API_KEY: "k" }), ProviderConfigError);
});

test("openai: non-stop finish_reason and refusals fail the run", async () => {
  const cut = await run("openai", [openaiReply(PLAN, "length")]);
  assert.equal(cut.result.verdict, "FAILED");
  assert.match(cut.result.proof.requirement_verdicts.at(-1)!.reason, /finish_reason=length/);
  assert.equal(cut.stub.requests.length, 1, "incomplete output is not retried");

  const refused = await run("openai", [{ body: { id: "c", choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] } }]);
  assert.equal(refused.result.verdict, "FAILED");
  assert.match(refused.result.proof.requirement_verdicts.at(-1)!.reason, /refused/);
});

test("retries: 429 with retry-after then success recovers; attempts recorded in evidence", async () => {
  const { result, stub } = await run("anthropic", [
    { status: 429, body: { type: "error", error: { type: "rate_limit_error" } }, headers: { "retry-after": "0" } },
    anthropicReply(PLAN),
    anthropicReply(ARTIFACT),
  ]);
  assert.equal(result.verdict, "VERIFIED");
  assert.equal(stub.requests.length, 3);
  const planner = result.evidence.find((e) => e.kind === "provider_call" && e.agent_id === "planner")!;
  assert.equal(planner.data.attempts, 2);
});

test("retries: 5xx and timeouts are retried, then the run fails with every attempt listed", async () => {
  const { result, stub } = await run("openai", [{ ...openaiReply(PLAN), delay_ms: 400 }], { OSA_PROVIDER_TIMEOUT_MS: "100", OSA_PROVIDER_MAX_RETRIES: "2" });
  assert.equal(result.verdict, "FAILED");
  assert.equal(stub.requests.length, 3);
  const reason = result.proof.requirement_verdicts.at(-1)!.reason;
  assert.match(reason, /openai failed after 3 attempts: openai request timed out after 100ms; openai HTTP 500 \(server_error\); openai HTTP 500 \(server_error\)/);
  assert.ok(!reason.includes(SECRET));
});

test("retries: 4xx is never retried; x-should-retry overrides the status rule", async () => {
  const bad = await run("openai", [{ status: 400, body: { error: { type: "invalid_request_error" } } }]);
  assert.equal(bad.result.verdict, "FAILED");
  assert.equal(bad.stub.requests.length, 1);

  const forced = await run("openai", [{ status: 400, body: { error: { type: "invalid_request_error" } }, headers: { "x-should-retry": "true" } }, openaiReply(PLAN), openaiReply(ARTIFACT)]);
  assert.equal(forced.result.verdict, "VERIFIED");
  assert.equal(forced.stub.requests.length, 3);

  const blocked = await run("openai", [{ status: 503, body: { error: { type: "overloaded" } }, headers: { "x-should-retry": "false" } }]);
  assert.equal(blocked.stub.requests.length, 1);
});

test("retries: OSA_PROVIDER_MAX_RETRIES bounds attempts and is validated", async () => {
  const none = await run("openai", [], { OSA_PROVIDER_MAX_RETRIES: "0" });
  assert.equal(none.result.verdict, "FAILED");
  assert.equal(none.stub.requests.length, 1);
  for (const bad of ["-1", "11", "two"]) {
    assert.throws(() => createDevExecution(env("openai", "http://127.0.0.1:1", { OSA_PROVIDER_MAX_RETRIES: bad })), ProviderConfigError);
  }
});

test("retry delay: retry-after-ms / retry-after honoured and capped; backoff doubles to 8 s with <=25% jitter", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(retryAfterMs(h({ "retry-after-ms": "1234" })), 1234);
  assert.equal(retryAfterMs(h({ "retry-after": "2" })), 2000);
  assert.equal(retryAfterMs(h({})), undefined);
  assert.equal(isRetryableStatus(408, h({})), true);
  assert.equal(isRetryableStatus(409, h({})), true);
  assert.equal(isRetryableStatus(429, h({})), true);
  assert.equal(isRetryableStatus(502, h({})), true);
  assert.equal(isRetryableStatus(401, h({})), false);

  const withHeader = new ProviderCallError("x", { retryable: true, retryAfterMs: 1500 });
  assert.equal(retryDelayMs(0, withHeader, { maxRetries: 2 }), 1500);
  const tooLong = new ProviderCallError("x", { retryable: true, retryAfterMs: 120_000 });
  const plain = new ProviderCallError("x", { retryable: true });
  const noJitter = { maxRetries: 5, random: () => 0 };
  assert.equal(retryDelayMs(0, tooLong, noJitter), 500, "retry-after above 60 s falls back to backoff");
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => retryDelayMs(n, plain, noJitter)), [500, 1000, 2000, 4000, 8000, 8000]);
  assert.equal(retryDelayMs(0, plain, { maxRetries: 1, random: () => 1 }), 375);
});

test("retry wrapper: sleeps between attempts, never after the last, and passes non-provider errors through", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const inner: ModelProvider = {
    id: "p", model: "m",
    complete: async (_r: ModelRequest): Promise<ModelResponse> => { calls += 1; throw new ProviderCallError(`HTTP 500 #${calls}`, { retryable: true, status: 500 }); },
  };
  const provider = new RetryingProvider(inner, { maxRetries: 2, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
  await assert.rejects(provider.complete({ system: "", prompt: "", output_schema: {} }), /p failed after 3 attempts: HTTP 500 #1; HTTP 500 #2; HTTP 500 #3/);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [500, 1000]);

  const boom: ModelProvider = { id: "b", model: "m", complete: async () => { throw new TypeError("bug"); } };
  await assert.rejects(new RetryingProvider(boom, { maxRetries: 3 }).complete({ system: "", prompt: "", output_schema: {} }), TypeError);
  assert.throws(() => new RetryingProvider(boom, { maxRetries: -1 }), RangeError);
});
