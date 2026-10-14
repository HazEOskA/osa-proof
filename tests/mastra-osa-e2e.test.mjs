import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { createOsaDelegationTool } from "../integrations/mastra/mastra-tool.mjs";

const require = createRequire(import.meta.url);
const { createApiServer, ApiState } = require("../dist/apps/api/src/index.js");
const { createDevFixtureRegistry } = require("../dist/apps/api/src/server.js");
const { verifyMastraOsaMissionRecord } = require("../dist/integrations/mastra/verify-mission.js");

test("real Mastra SDK tool -> OSA HTTP API -> runtime -> canonical receipt verifier", async () => {
  const registry = createDevFixtureRegistry();
  const server = createApiServer(registry, new ApiState(undefined, undefined, undefined, "open"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const localBase = `http://127.0.0.1:${server.address().port}`;
  const fetchImpl = (url, options) => fetch(localBase + new URL(url).pathname, options);
  const graph = {
    organization_id: "org_dev_local", project_id: "mastra-test", team_id: "mastra-fixture", version: "1",
    agents: [
      { agent_id: "plan", role: "planner", executor_ref: "dev.planner.v1" },
      { agent_id: "build", role: "builder", executor_ref: "dev.builder.v1" }
    ],
    edges: [{ edge_id: "handoff", from_agent_id: "plan", to_agent_id: "build", kind: "handoff" }]
  };
  try {
    const teamResponse = await fetch(localBase + "/teams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(graph) });
    assert.equal(teamResponse.status, 201);
    const tool = createOsaDelegationTool({
      apiBaseUrl: "https://osa.invalid",
      token: "fixture-only-not-a-real-credential",
      fetchImpl,
      missionFactory: ({ toolCallId, input }) => ({
        organization_id: graph.organization_id, project_id: graph.project_id,
        mission_id: `mastra-${toolCallId}`, team_id: graph.team_id, team_version: graph.version,
        entry_agent_id: "plan", objective: input.task, input,
        requirements: [{ requirement_id: "artifact-built", type: "evidence_field_equals", agent_id: "build", evidence_kind: "artifact", field: "status", expected: "built" }]
      }),
      verifyReceipt: async ({ mission, run, receipt, record }) =>
        verifyMastraOsaMissionRecord(record, {
          mission_id: mission.mission_id, run_id: run.run_id,
          execution_id: run.execution_id, receipt_sha256: receipt.receipt_sha256
        })
    });
    const requestContext = { get: key => ({ osaMastraRunId: "mastra-run-1", osaToolCallId: "tool-call-1" })[key] };
    const result = await tool.execute({ task: "Build fixture artifact" }, { requestContext });
    assert.equal(result.osa_verdict, "VERIFIED");
    assert.equal(result.osa_mission_id, "mastra-tool-call-1");
    assert.equal(result.verification, "VERIFIER_CALLBACK_APPROVED");
    assert.ok(result.mission_receipt_sha256);
    // Tamper only with the persisted HTTP record, not the runtime's stored data.
    // A valid run and receipt must still be rejected when the record is altered in transit.
    const tamperedFetch = async (url, options) => {
      const response = await fetchImpl(url, options);
      if (new URL(url).pathname !== "/missions/mastra-tool-call-tampered" || options.method !== "GET" || !response.ok) return response;
      const record = await response.json();
      record.timeline[0].payload.injected = "tampered-in-transit";
      return new Response(JSON.stringify(record), { status: response.status, headers: { "content-type": "application/json" } });
    };
    const tamperTool = createOsaDelegationTool({
      apiBaseUrl: "https://osa.invalid",
      token: "fixture-only-not-a-real-credential",
      fetchImpl: tamperedFetch,
      missionFactory: ({ toolCallId, input }) => ({
        organization_id: graph.organization_id, project_id: graph.project_id,
        mission_id: `mastra-${toolCallId}`, team_id: graph.team_id, team_version: graph.version,
        entry_agent_id: "plan", objective: input.task, input,
        requirements: [{ requirement_id: "artifact-built", type: "evidence_field_equals", agent_id: "build", evidence_kind: "artifact", field: "status", expected: "built" }]
      }),
      verifyReceipt: async ({ mission, run, receipt, record }) =>
        verifyMastraOsaMissionRecord(record, {
          mission_id: mission.mission_id, run_id: run.run_id,
          execution_id: run.execution_id, receipt_sha256: receipt.receipt_sha256
        })
    });
    await assert.rejects(
      tamperTool.execute({ task: "Build fixture artifact" }, {
        requestContext: { get: key => ({ osaMastraRunId: "mastra-run-1", osaToolCallId: "tool-call-tampered" })[key] }
      }),
      error => error.code === "VERIFIER_FAILED"
    );
    await assert.rejects(
      tool.execute({ task: "Build fixture artifact" }, { requestContext }),
      error => error.code === "DUPLICATE_MISSION"
    );
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
