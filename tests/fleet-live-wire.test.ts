import assert from "node:assert/strict";
import test from "node:test";
import type { AgentExecutionContext } from "../packages/contracts/src";
import { createFleetChatExecutor } from "../packages/adapters/src/integrations";

const url = process.env.OSA_E2E_FLEET_URL;
const token = process.env.OSA_E2E_FLEET_TOKEN;
const enabled = Boolean(url && token);
const context: AgentExecutionContext = {
  mission: {
    organization_id: "org", project_id: "project", mission_id: "m",
    team_id: "team", team_version: "1", entry_agent_id: "agent",
    objective: "verify live Fleet HTTP wiring", input: { prompt: "hello" }, requirements: [],
  },
  agent: { agent_id: "agent", role: "builder", executor_ref: "dev.builder.v1" },
  input: {}, run_id: "r", execution_id: "e", operation_id: "o",
};

test("Fleet service real HTTP handshake fails closed, without provider keys", { skip: !enabled }, async () => {
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { hasKey: boolean }).hasKey, false);

  const raw = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: "test" }] }),
  });
  assert.equal(raw.status, 401);

  const authenticated = createFleetChatExecutor({
    baseUrl: url!, apiKey: token!, timeoutMs: 5000,
  });
  // Authenticated request reaches Fleet, but cannot execute a paid model
  // in this purposely keyless test environment.
  await assert.rejects(Promise.resolve().then(() => authenticated(context)), /FLEET_HTTP_400/);

  const invalid = createFleetChatExecutor({
    baseUrl: url!, apiKey: "wrong-test-credential-of-adequate-length", timeoutMs: 5000,
  });
  await assert.rejects(Promise.resolve().then(() => invalid(context)), /FLEET_HTTP_401/);
});
