import assert from "node:assert/strict";
import test from "node:test";
import type { AgentExecutionContext } from "../packages/contracts/src";
import { createFleetChatExecutor } from "../packages/adapters/src/integrations";

const scope = { organization_id: "org", project_id: "project", mission_id: "mission" };
function context(): AgentExecutionContext {
  return {
    mission: {
      ...scope, team_id: "team", team_version: "1", entry_agent_id: "builder",
      objective: "ask fleet", input: { message: "Hello from OSA" }, requirements: [],
    },
    agent: { agent_id: "builder", role: "builder", executor_ref: "dev.builder.v1" },
    input: { model: "gemini-test" }, run_id: "run", execution_id: "exec", operation_id: "op",
  };
}
const config = {
  baseUrl: "https://fleet.internal.example",
  apiKey: "service-token-with-32-plus-characters",
  timeoutMs: 5000,
};

test("Fleet HTTP adapter authenticates with a server-side service token and parses actual SSE", async () => {
  let called = 0;
  const executor = createFleetChatExecutor(config, async (url, init) => {
    called++;
    assert.equal(String(url), "https://fleet.internal.example/api/chat");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${config.apiKey}`);
    assert.equal(init?.method, "POST");
    const input = JSON.parse(String(init?.body)) as { messages: Array<{ text: string }>; model: string };
    assert.equal(input.messages[0].text, "Hello from OSA");
    assert.equal(input.model, "gemini-test");
    return new Response(
      'data: {"text":"Hello"}\n\ndata: {"type":"done"}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  });
  const output = await executor(context());
  assert.equal(called, 1);
  assert.equal((output.output as { text: string }).text, "Hello");
  assert.ok(output.evidence.some(item => item.kind === "fleet_chat"));
});

test("Fleet failure event never becomes completed execution evidence", async () => {
  const executor = createFleetChatExecutor(config, async () => new Response(
    'data: {"text":"partial"}\n\ndata: {"type":"error","error":{"code":"GENERATION_FAILED"}}\n\n',
    { status: 200, headers: { "content-type": "text/event-stream" } }
  ));
  await assert.rejects(Promise.resolve().then(() => executor(context())), /FLEET_GENERATION_FAILED/);
});

test("Fleet unauthorized response never becomes verified evidence", async () => {
  const executor = createFleetChatExecutor(config, async () => new Response(
    '{"error":"UNAUTHORIZED"}', { status: 401, headers: { "content-type": "application/json" } }
  ));
  await assert.rejects(Promise.resolve().then(() => executor(context())), /FLEET_HTTP_401/);
});
