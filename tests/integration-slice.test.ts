import assert from "node:assert/strict";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createDevExecution, DEV_BUILDER_REF, DEV_PLANNER_REF } from "../apps/api/src/server";
import { IntegrationConfigError, loadIntegrationConfig, routeCapability } from "../packages/adapters/src";
import { Mission, TeamGraph } from "../packages/contracts/src";
import { OsaRuntime } from "../packages/runtime/src";

const BUILDER_TOKEN = "builder-bridge-secret";
const EXECUTION_TOKEN = "execution-force-secret";

const graph: TeamGraph = {
  organization_id: "org_integration",
  project_id: "project_integration_v01",
  team_id: "team_integration_v01",
  version: "1",
  agents: [
    { agent_id: "planner", role: "planner", executor_ref: DEV_PLANNER_REF },
    { agent_id: "builder", role: "builder", executor_ref: DEV_BUILDER_REF },
  ],
  edges: [
    { edge_id: "planner_to_builder", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" },
  ],
};

function mission(capability: string, id: string): Mission {
  return {
    organization_id: graph.organization_id,
    project_id: graph.project_id,
    mission_id: id,
    team_id: graph.team_id,
    team_version: graph.version,
    objective:
      capability === "RUN_TOOL"
        ? "Execute the selected runtime skill"
        : capability === "AGENT_TASK"
          ? "Summarize the task"
          : "Build the requested repository change",
    entry_agent_id: "planner",
    input: {
      capability,
      repo_url: "https://github.com/HazEOskA/osa-proof",
      task: "Integration Slice V0.1 test",
    },
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

interface RequestRecord {
  method: string;
  path: string;
  authorization?: string;
  body?: Record<string, unknown>;
}

async function startIntegrationStub(): Promise<{
  base: string;
  requests: RequestRecord[];
  close(): Promise<void>;
}> {
  const requests: RequestRecord[] = [];
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const authorization = request.headers.authorization;
    requests.push({ method: request.method ?? "GET", path, authorization, body });

    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && path === "/api/tasks") {
      assert.equal(authorization, `Bearer ${BUILDER_TOKEN}`);
      assert.equal(body?.repoUrl, "https://github.com/HazEOskA/osa-proof");
      response.writeHead(200);
      response.end(JSON.stringify({ task: { id: "task_osa_v01", status: "pending" } }));
      return;
    }

    if (request.method === "GET" && path === "/api/tasks/task_osa_v01") {
      assert.equal(authorization, `Bearer ${BUILDER_TOKEN}`);
      response.writeHead(200);
      response.end(
        JSON.stringify({
          task: {
            id: "task_osa_v01",
            status: "completed",
            branchName: "osa/integration-v01",
            previewUrl: "https://preview.invalid/osa",
            prUrl: "https://github.com/HazEOskA/osa-proof/pull/999",
            prNumber: 999,
          },
        })
      );
      return;
    }

    if (request.method === "POST" && path === "/api/v2/missions/run") {
      assert.equal(authorization, `Bearer ${EXECUTION_TOKEN}`);
      assert.equal(body?.environment, "development");
      response.writeHead(201);
      response.end(
        JSON.stringify({
          mission_id: "oef_mission_1",
          execution_id: "oef_exec_1",
          state: "COMPLETED",
          result: { ok: true },
        })
      );
      return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: "not found" }));
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

function integrationEnv(base: string, overrides: Record<string, string | undefined> = {}) {
  return {
    OSA_EXECUTION_MODE: "fixture",
    OSA_INTEGRATION_ENABLED: "1",
    OSA_BUILDER_BASE_URL: base,
    OSA_BUILDER_BRIDGE_TOKEN: BUILDER_TOKEN,
    OSA_BUILDER_DEFAULT_REPO_URL: "https://github.com/HazEOskA/osa-proof",
    OSA_BUILDER_POLL_INTERVAL_MS: "5",
    OSA_BUILDER_TIMEOUT_MS: "2000",
    OSA_EXECUTION_FORCE_BASE_URL: base,
    OSA_EXECUTION_FORCE_API_KEY: EXECUTION_TOKEN,
    OSA_EXECUTION_FORCE_TIMEOUT_MS: "2000",
    ...overrides,
  };
}

test("Integration V0.1: BUILD_CODE -> Coding Agent Platform -> evidence -> VERIFIED", async () => {
  const stub = await startIntegrationStub();
  try {
    const execution = createDevExecution(integrationEnv(stub.base));
    const result = await new OsaRuntime(execution.registry).run(graph, mission("BUILD_CODE", "mission_builder_v01"));

    assert.equal(result.verdict, "VERIFIED");
    assert.equal(result.proof.verdict, "VERIFIED");
    assert.equal(result.final_output && typeof result.final_output === "object" && (result.final_output as any).capability, "BUILD_CODE");
    assert.equal(result.evidence.find((item) => item.kind === "route")?.data.target, "coding-agent-platform");
    assert.equal(result.evidence.find((item) => item.kind === "builder_task")?.data.status, "completed");
    assert.equal(result.evidence.find((item) => item.kind === "artifact")?.data.status, "built");
    assert.ok(stub.requests.some((item) => item.path === "/api/tasks"));
    assert.ok(stub.requests.some((item) => item.path === "/api/tasks/task_osa_v01"));
    assert.ok(!JSON.stringify(result).includes(BUILDER_TOKEN));
  } finally {
    await stub.close();
  }
});

test("Integration V0.1: RUN_TOOL -> Execution Force -> evidence -> VERIFIED", async () => {
  const stub = await startIntegrationStub();
  try {
    const execution = createDevExecution(integrationEnv(stub.base));
    const result = await new OsaRuntime(execution.registry).run(graph, mission("RUN_TOOL", "mission_execution_v01"));

    assert.equal(result.verdict, "VERIFIED");
    assert.equal(result.evidence.find((item) => item.kind === "route")?.data.target, "osa-execution-force");
    assert.equal(result.evidence.find((item) => item.kind === "execution_force_call")?.data.status, "completed");
    assert.equal(result.evidence.find((item) => item.kind === "artifact")?.data.status, "built");
    assert.ok(stub.requests.some((item) => item.path === "/api/v2/missions/run"));
    assert.ok(!JSON.stringify(result).includes(EXECUTION_TOKEN));
  } finally {
    await stub.close();
  }
});

test("Integration V0.1: AGENT_TASK stays on canonical native runtime", async () => {
  const stub = await startIntegrationStub();
  try {
    const execution = createDevExecution(integrationEnv(stub.base));
    const result = await new OsaRuntime(execution.registry).run(graph, mission("AGENT_TASK", "mission_native_v01"));

    assert.equal(result.verdict, "VERIFIED");
    assert.equal(result.evidence.find((item) => item.kind === "route")?.data.target, "native-runtime");
    assert.equal(result.evidence.find((item) => item.kind === "artifact")?.data.source, "dev-fixture");
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});

test("Integration V0.1 fails closed when selected bridge is not configured", async () => {
  const stub = await startIntegrationStub();
  try {
    const execution = createDevExecution(
      integrationEnv(stub.base, {
        OSA_BUILDER_BASE_URL: undefined,
        OSA_BUILDER_BRIDGE_TOKEN: undefined,
      })
    );
    const result = await new OsaRuntime(execution.registry).run(graph, mission("BUILD_CODE", "mission_missing_builder"));

    assert.equal(result.verdict, "FAILED");
    assert.match(result.proof.runtime_failure ?? "", /BUILD_CODE integration is not configured/);
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});

test("Integration V0.1 configuration rejects half-configured credentials", () => {
  assert.throws(
    () =>
      loadIntegrationConfig({
        OSA_INTEGRATION_ENABLED: "1",
        OSA_BUILDER_BASE_URL: "https://builder.example",
      }),
    IntegrationConfigError
  );
});

test("Integration V0.1 deterministic router honors explicit capability before keyword inference", () => {
  const baseMission = mission("AGENT_TASK", "route_test");
  assert.equal(routeCapability({ mission: baseMission, input: { capability: "RUN_TOOL" } }), "RUN_TOOL");
  assert.equal(routeCapability({ mission: { ...baseMission, objective: "Fix repository tests" }, input: {} }), "BUILD_CODE");
  assert.equal(routeCapability({ mission: { ...baseMission, objective: "Audit proof receipt" }, input: {} }), "VERIFY");
  assert.equal(routeCapability({ mission: { ...baseMission, objective: "Zbudować poprawkę w repozytorium" }, input: {} }), "BUILD_CODE");
  assert.equal(routeCapability({ mission: { ...baseMission, objective: "Uruchom narzędzie" }, input: {} }), "RUN_TOOL");
  assert.equal(routeCapability({ mission: { ...baseMission, objective: "Sprawdź dowód" }, input: {} }), "VERIFY");
});
