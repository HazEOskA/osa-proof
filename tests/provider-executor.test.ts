import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createApiServer } from "../apps/api/src";
import {
  createDevExecution,
  DEV_BUILDER_REF,
  DEV_PLANNER_REF,
  ExecutionConfigError,
  startApiServer,
} from "../apps/api/src/server";
import { ProviderConfigError } from "../packages/adapters/src";
import { Mission, RunResult, TeamGraph } from "../packages/contracts/src";
import { MemoryEventStore } from "../packages/events/src";
import { OsaRuntime } from "../packages/runtime/src";

const SECRET = "sk-ant-test-SECRET-7f3c9a";

const graph: TeamGraph = {
  organization_id: "org_dev",
  project_id: "project_dev_live_slice",
  team_id: "team_dev",
  version: "1",
  agents: [
    { agent_id: "planner", role: "planner", executor_ref: DEV_PLANNER_REF },
    { agent_id: "builder", role: "builder", executor_ref: DEV_BUILDER_REF },
  ],
  edges: [{ edge_id: "planner_to_builder", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
};

function mission(id = "mission_provider"): Mission {
  return {
    organization_id: graph.organization_id,
    project_id: graph.project_id,
    mission_id: id,
    team_id: graph.team_id,
    team_version: graph.version,
    objective: "Write a haiku about proof",
    entry_agent_id: "planner",
    input: { request: "Write a haiku about proof" },
    requirements: [
      {
        requirement_id: "artifact_status",
        type: "evidence_field_equals",
        evidence_kind: "artifact",
        agent_id: "builder",
        field: "status",
        expected: "built",
      },
    ],
  };
}

type Reply = { status?: number; body: unknown; delay_ms?: number };

interface Stub {
  base: string;
  requests: Array<{ headers: IncomingMessage["headers"]; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

async function startStub(replies: Reply[]): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const queue = [...replies];
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    const reply = queue.shift() ?? { status: 500, body: { type: "error", error: { type: "api_error" } } };
    if (reply.delay_ms) await new Promise((resolve) => setTimeout(resolve, reply.delay_ms));
    if (response.destroyed) return;
    response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
    response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function message(text: string, overrides: Record<string, unknown> = {}): Reply {
  return {
    body: {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      type: "message",
      role: "assistant",
      model: "claude-test-model",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 42, output_tokens: 17 },
      ...overrides,
    },
  };
}

const PLAN = JSON.stringify({ summary: "three lines", steps: ["draft", "count syllables"] });
const ARTIFACT_CONTENT = "Claims drift like mist\nevidence stays, hashed and still\nproof outlasts the word";
const ARTIFACT = JSON.stringify({ title: "Proof haiku", content: ARTIFACT_CONTENT });

function providerEnv(base: string, overrides: Record<string, string | undefined> = {}) {
  return {
    OSA_EXECUTION_MODE: "provider",
    OSA_PROVIDER: "anthropic",
    OSA_MODEL: "claude-test-model",
    ANTHROPIC_API_KEY: SECRET,
    OSA_PROVIDER_BASE_URL: base,
    OSA_PROVIDER_TIMEOUT_MS: "2000",
    ...overrides,
  };
}

async function runWithStub(
  replies: Reply[],
  envOverrides: Record<string, string | undefined> = {}
): Promise<{ result: RunResult; stub: Stub; persisted: string }> {
  const stub = await startStub(replies);
  try {
    const execution = createDevExecution(providerEnv(stub.base, envOverrides));
    const eventStore = new MemoryEventStore();
    const result = await new OsaRuntime(execution.registry, { eventStore }).run(graph, mission());
    const persisted = JSON.stringify(await eventStore.list(result.run_id));
    return { result, stub, persisted };
  } finally {
    await stub.close();
  }
}

function assertNoSecret(...values: unknown[]): void {
  for (const value of values) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    assert.ok(!serialized.includes(SECRET), "provider secret leaked");
  }
}

test("provider: valid structured responses produce provider evidence and VERIFIED", async () => {
  const { result, stub, persisted } = await runWithStub([message(PLAN), message(ARTIFACT)]);

  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.proof.verdict, "VERIFIED");
  assert.equal(result.events.at(-1)?.type, "RUN_VERIFIED");
  assert.deepEqual(
    result.evidence.map((record) => `${record.agent_id}:${record.kind}`),
    ["planner:provider_call", "planner:plan", "builder:provider_call", "builder:artifact"]
  );

  const artifact = result.evidence.find((record) => record.kind === "artifact");
  assert.equal(artifact?.data.status, "built");
  assert.equal(
    artifact?.data.content_sha256,
    createHash("sha256").update(ARTIFACT_CONTENT, "utf8").digest("hex")
  );
  assert.equal(artifact?.data.bytes, Buffer.byteLength(ARTIFACT_CONTENT, "utf8"));
  assert.equal(artifact?.data.source, "provider");
  assert.deepEqual(result.proof.requirement_verdicts[0].evidence_ids, [artifact?.evidence_id]);

  const call = result.evidence.find((record) => record.kind === "provider_call" && record.agent_id === "builder");
  assert.equal(call?.data.http_status, 200);
  assert.equal(call?.data.stop_reason, "end_turn");
  assert.match(String(call?.data.response_sha256), /^[0-9a-f]{64}$/);

  assert.equal(stub.requests.length, 2);
  for (const request of stub.requests) {
    assert.equal(request.headers["x-api-key"], SECRET);
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    assert.equal(request.body.model, "claude-test-model");
    assert.equal((request.body.output_config as { format: { type: string } }).format.type, "json_schema");
  }
  assertNoSecret(result, persisted);
});

test("provider: model-claimed status without structured content yields FAILED", async () => {
  const { result } = await runWithStub([message(PLAN), message(JSON.stringify({ status: "built" }))]);
  assert.equal(result.verdict, "FAILED");
  const artifact = result.evidence.find((record) => record.kind === "artifact");
  assert.equal(artifact?.data.status, "rejected");
  assert.equal(result.proof.requirement_verdicts[0].verdict, "FAILED");
  assert.equal(result.events.at(-1)?.type, "RUN_FAILED");
});

test("provider: empty artifact content yields FAILED", async () => {
  const { result } = await runWithStub([message(PLAN), message(JSON.stringify({ title: "t", content: "   " }))]);
  assert.equal(result.verdict, "FAILED");
  assert.equal(result.evidence.find((record) => record.kind === "artifact")?.data.status, "rejected");
});

test("provider: invalid JSON output yields FAILED", async () => {
  const { result } = await runWithStub([message(PLAN), message("Sure! Here is your artifact: done.")]);
  assert.equal(result.verdict, "FAILED");
  const artifact = result.evidence.find((record) => record.kind === "artifact");
  assert.equal(artifact?.data.status, "rejected");
  assert.equal(artifact?.data.reason, "response is not valid JSON");
});

test("provider: rejected plan stops the builder before any provider call", async () => {
  const { result, stub } = await runWithStub([message("not json")]);
  assert.equal(result.verdict, "FAILED");
  assert.equal(stub.requests.length, 1);
  assert.equal(result.evidence.find((record) => record.kind === "plan")?.data.status, "rejected");
  assert.equal(result.evidence.find((record) => record.kind === "artifact")?.data.status, "rejected");
});

test("provider: HTTP failure yields FAILED runtime execution", async () => {
  const { result, persisted } = await runWithStub([
    message(PLAN),
    { status: 500, body: { type: "error", error: { type: "api_error", message: "boom" } } },
  ]);
  assert.equal(result.verdict, "FAILED");
  const runtimeVerdict = result.proof.requirement_verdicts.at(-1);
  assert.equal(runtimeVerdict?.requirement_id, "__runtime_execution__");
  assert.match(runtimeVerdict?.reason ?? "", /HTTP 500 \(api_error\)/);
  assert.ok(result.events.some((event) => event.type === "AGENT_FAILED" && event.agent_id === "builder"));
  assert.equal(result.events.at(-1)?.type, "RUN_FAILED");
  assertNoSecret(result, persisted);
});

test("provider: non end_turn stop reason yields FAILED", async () => {
  const { result } = await runWithStub([message(PLAN), message(ARTIFACT, { stop_reason: "max_tokens" })]);
  assert.equal(result.verdict, "FAILED");
  assert.match(result.proof.requirement_verdicts.at(-1)?.reason ?? "", /stop_reason=max_tokens/);
});

test("provider: timeout yields FAILED", async () => {
  const { result } = await runWithStub(
    [{ ...message(PLAN), delay_ms: 500 }],
    { OSA_PROVIDER_TIMEOUT_MS: "100" }
  );
  assert.equal(result.verdict, "FAILED");
  assert.match(result.proof.requirement_verdicts.at(-1)?.reason ?? "", /timed out after 100ms/);
  assert.ok(result.events.some((event) => event.type === "AGENT_FAILED" && event.agent_id === "planner"));
  assert.equal(result.evidence.length, 0);
});

test("provider: secret echoed by a hostile error body is redacted", async () => {
  const { result, persisted } = await runWithStub([
    { status: 401, body: { type: "error", error: { type: SECRET, message: `bad key ${SECRET}` } } },
  ]);
  assert.equal(result.verdict, "FAILED");
  assert.match(result.proof.requirement_verdicts.at(-1)?.reason ?? "", /\[REDACTED\]/);
  assertNoSecret(result, persisted);
});

test("execution mode is required and fails closed", () => {
  assert.throws(() => createDevExecution({}), ExecutionConfigError);
  assert.throws(() => createDevExecution({ OSA_EXECUTION_MODE: "" }), ExecutionConfigError);
  assert.throws(() => createDevExecution({ OSA_EXECUTION_MODE: "auto" }), ExecutionConfigError);
  assert.throws(() => startApiServer({ PORT: "3999" }), ExecutionConfigError);
});

test("provider mode fails closed on missing or unknown configuration", () => {
  const base = "http://127.0.0.1:1";
  for (const missing of ["OSA_PROVIDER", "OSA_MODEL", "ANTHROPIC_API_KEY"]) {
    assert.throws(
      () => createDevExecution(providerEnv(base, { [missing]: undefined })),
      (error: unknown) =>
        error instanceof ProviderConfigError &&
        error.message.includes(missing) &&
        !error.message.includes(SECRET)
    );
  }
  assert.throws(() => createDevExecution(providerEnv(base, { OSA_PROVIDER: "openai" })), ProviderConfigError);
  assert.throws(() => createDevExecution(providerEnv(base, { OSA_MODEL: "  " })), ProviderConfigError);
  assert.throws(
    () => createDevExecution(providerEnv(base, { OSA_PROVIDER_TIMEOUT_MS: "-5" })),
    ProviderConfigError
  );
});

test("provider mode registers only stable refs; startup description has no secret", () => {
  const execution = createDevExecution(providerEnv("http://127.0.0.1:1"));
  assert.deepEqual(execution.description, { mode: "provider", provider: "anthropic", model: "claude-test-model" });
  assertNoSecret(execution.description);
  assert.ok(execution.registry.get(DEV_PLANNER_REF));
  assert.ok(execution.registry.get(DEV_BUILDER_REF));
  assert.throws(() => execution.registry.get("dev.planner.fixture.v1"), /executor not registered/);
});

test("fixture mode serves the same stable refs deterministically", async () => {
  const execution = createDevExecution({ OSA_EXECUTION_MODE: "fixture" });
  const result = await new OsaRuntime(execution.registry).run(graph, mission("mission_fixture"));
  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.evidence.find((record) => record.kind === "artifact")?.data.source, "dev-fixture");
});

test("API -> provider stub -> evidence -> proof flow over HTTP", async () => {
  const stub = await startStub([message(PLAN), message(ARTIFACT)]);
  const server = createApiServer(createDevExecution(providerEnv(stub.base)).registry);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const login = await fetch(`${base}/auth/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: "Provider Test" }),
    });
    const { session } = (await login.json()) as { session: { token: string } };
    const headers = { "content-type": "application/json", authorization: `Bearer ${session.token}` };
    const currentMission = mission("mission_http_provider");

    assert.equal((await fetch(`${base}/teams`, { method: "POST", headers, body: JSON.stringify(graph) })).status, 201);
    assert.equal(
      (await fetch(`${base}/missions`, { method: "POST", headers, body: JSON.stringify(currentMission) })).status,
      201
    );
    const runResponse = await fetch(`${base}/missions/${currentMission.mission_id}/run`, { method: "POST", headers });
    assert.equal(runResponse.status, 201);
    const run = (await runResponse.json()) as { run_id: string; verdict: string };
    assert.equal(run.verdict, "VERIFIED");

    const [events, evidence, proof, stored] = await Promise.all(
      ["/events", "/evidence", "/proof", ""].map(async (suffix) => {
        const response = await fetch(`${base}/runs/${run.run_id}${suffix}`, { headers });
        assert.equal(response.status, 200);
        return response.json();
      })
    );

    assert.ok((events as Array<{ type: string }>).some((event) => event.type === "RUN_VERIFIED"));
    const artifact = (evidence as Array<{ kind: string; data: Record<string, unknown> }>).find(
      (record) => record.kind === "artifact"
    );
    assert.equal(artifact?.data.status, "built");
    assert.match(String(artifact?.data.content_sha256), /^[0-9a-f]{64}$/);
    assert.equal((proof as { verdict: string }).verdict, "VERIFIED");
    const finalOutput = (stored as { final_output: { objective: string; upstream: { received: { request: string } } } })
      .final_output;
    assert.equal(finalOutput.objective, currentMission.objective);
    assert.equal(finalOutput.upstream.received.request, currentMission.objective);
    assertNoSecret(events, evidence, proof, stored);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stub.close();
  }
});

test(
  "live provider smoke test (opt-in)",
  { skip: process.env.OSA_LIVE_PROVIDER_TEST !== "1" && "set OSA_LIVE_PROVIDER_TEST=1 with provider env to run" },
  async () => {
    const execution = createDevExecution({ ...process.env, OSA_EXECUTION_MODE: "provider" });
    const result = await new OsaRuntime(execution.registry).run(graph, mission("mission_live"));
    assert.equal(result.verdict, "VERIFIED", JSON.stringify(result.proof.requirement_verdicts));
  }
);
