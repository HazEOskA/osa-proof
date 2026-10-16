import assert from "node:assert/strict";
import test from "node:test";
import { loadIntegrationConfig, parseFleetSse } from "../packages/adapters/src/integrations";

const ok = [
  ": connected",
  "data: {\"text\":\"Hello \"}",
  "data: {\"text\":\"OSA\"}",
  "data: {\"type\":\"done\"}",
  "data: [DONE]",
  "",
].join("\n\n");

test("Fleet SSE returns assembled model output only after terminal success", () => {
  assert.deepEqual(parseFleetSse(ok), { text: "Hello OSA", grounding: [] });
  assert.equal(parseFleetSse('data: {"text":"ok"}\n\ndata: [DONE]\n\n').text, "ok");
});
test("Fleet SSE errors do not become a successful model message", () => {
  const failed = 'data: {"text":"partial"}\n\ndata: {"type":"error","error":{"code":"GENERATION_FAILED"}}\n\n';
  assert.throws(() => parseFleetSse(failed), /FLEET_GENERATION_FAILED/);
  assert.throws(() => parseFleetSse('data: {"type":"error"}\n\ndata: [DONE]\n\n'), /FLEET_GENERATION_FAILED/);
});
test("Fleet SSE truncated or invalid streams fail closed", () => {
  assert.throws(() => parseFleetSse('data: {"text":"partial"}\n\n'), /FLEET_SSE_INCOMPLETE/);
  assert.throws(() => parseFleetSse('data: not-json\n\ndata: [DONE]\n\n'), /FLEET_SSE_INVALID_JSON/);
  assert.throws(() => parseFleetSse('data: [DONE]\n\n'), /FLEET_SSE_EMPTY/);
  assert.throws(() => parseFleetSse('data: {"type":"done"}\n\ndata: {"text":"late"}\n\n'), /FLEET_SSE_AFTER_TERMINAL/);
});
test("Fleet URL without a service token cannot be configured", () => {
  assert.throws(() => loadIntegrationConfig({ OSA_INTEGRATION_ENABLED: "1", OSA_FLEET_BASE_URL: "https://fleet.example" }), /OSA_FLEET_API_KEY/);
  assert.throws(() => loadIntegrationConfig({ OSA_INTEGRATION_ENABLED: "1", OSA_FLEET_BASE_URL: "https://fleet.example", OSA_FLEET_API_KEY: "short" }), /OSA_FLEET_API_KEY/);
  const configured = loadIntegrationConfig({ OSA_INTEGRATION_ENABLED: "1", OSA_FLEET_BASE_URL: "https://fleet.example", OSA_FLEET_API_KEY: "x".repeat(32) });
  assert.equal(configured.fleet?.apiKey.length, 32);
});
