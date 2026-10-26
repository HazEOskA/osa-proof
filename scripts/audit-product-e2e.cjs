"use strict";
// Local HTTP audit. No provider calls, external credentials, cloud writes or Docker containers.
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { createServer } = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { ApiState, handleApiRequest, createApiServer } = require("../dist/apps/api/src");
const { createDevExecution } = require("../dist/apps/api/src/server");
const { createWorkerServer } = require("../dist/apps/worker/src");
const { DockerWorkspaceProvider } = require("../dist/packages/workspace-runtime/src");
const { PERMISSIONS } = require("../dist/packages/control/src");
const report = { schema: "osa.product_audit.v1", routes: [], tools: [], paid_calls: 0,
  assurance: "LOCAL_HTTP_NATIVE_TOOLS_AND_ROUTE_AUTH_ONLY", external_model_tool_calls: "NOT_TESTED",
  docker_execution: "NOT_TESTED", browser: "SEPARATE_CHECK_REQUIRED" };
const servers = [];
const original = new Map(["OSA_UNIFIED_ORIGIN", "OSA_WORKER_BASE_URL", "OSA_WORKER_TOKEN"].map(k => [k, process.env[k]]));
async function listen(server) {
  servers.push(server);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return "http://127.0.0.1:" + server.address().port;
}
async function main() {
  const protectedExecution = createDevExecution({ OSA_EXECUTION_MODE: "fixture" });
  const authBase = await listen(createApiServer(protectedExecution.registry, new ApiState(), protectedExecution.description));
  for (const row of PERMISSIONS) {
    const route = row.path.replace(/:collection/g, "audit").replace(/:tag/g, "audit").replace(/:id/g, "audit-missing");
    const response = await fetch(authBase + route, { method: row.method,
      ...(row.method === "POST" || row.method === "PUT" ? { body: "{}", headers: { "content-type": "application/json" } } : {}) });
    const body = await response.json();
    if (row.enforced === "session") assert.equal(response.status, 401, row.method + " " + row.path);
    else assert.ok([200, 201, 400, 403, 404, 409].includes(response.status), row.method + " " + row.path + " HTTP " + response.status);
    assert.ok(body !== undefined);
    report.routes.push({ method: row.method, path: row.path, auth: row.enforced, status: response.status, result: "PASS" });
  }
  const token = "audit-local-worker-" + randomUUID();
  process.env.OSA_WORKER_BASE_URL = await listen(createWorkerServer({ token, provider: new DockerWorkspaceProvider() }));
  process.env.OSA_WORKER_TOKEN = token;
  const execution = createDevExecution({ OSA_EXECUTION_MODE: "fixture" });
  const state = new ApiState(undefined, undefined, undefined, "open");
  const base = await listen(createServer((req, res) => {
    req.url = req.url.replace(/^\/api\//, "/");
    void handleApiRequest(req, res, execution.registry, state, execution.description);
  }));
  process.env.OSA_UNIFIED_ORIGIN = base;
  const post = async (route, payload) => {
    const response = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  for (const [message, ref] of [
    ["Oblicz SHA-256 tekstu: OSA audit", "osa.crypto.sha256.v1"],
    ["Sprawdź status runtime OSA Proof", "osa.runtime.inspect.v1"],
    ["Pokaż status workera", "osa.worker.health.v1"],
  ]) {
    const execution_id = "exec_" + randomUUID();
    const result = await post("/unified/execute", { message, execution_id });
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "EXECUTED");
    assert.equal(result.body.tool, ref);
    assert.equal(result.body.run.execution_id, execution_id);
    if (ref === "osa.crypto.sha256.v1") assert.equal(result.body.run.final_output.sha256, createHash("sha256").update("OSA audit").digest("hex"));
    if (ref === "osa.runtime.inspect.v1") assert.deepEqual(result.body.run.final_output.steps.map(s => s.http_status), [200, 200]);
    const verified = await post("/unified/verify", result.body);
    assert.equal(verified.body.ok, true);
    const tampered = structuredClone(result.body);
    tampered.run.final_output = { forged: true };
    assert.equal((await post("/unified/verify", tampered)).body.ok, false);
    report.tools.push({ ref, result: "PASS", execution_id, proof_id: result.body.run.proof.proof_id, tampering_rejected: true });
  }
  const blocked = await post("/unified/execute", { message: "Wdróż aplikację", execution_id: "exec_" + randomUUID() });
  assert.equal(blocked.body.status, "BLOCKED");
  const dispatch = await post("/unified/execute", { message: "Zapisz odpowiedź", execution_id: "exec_" + randomUUID(), tool: "osa.conversation.record.v1" });
  assert.equal(dispatch.status, 403);
  report.tools.push({ ref: "osa.unified.blocked.v1", result: "PASS_EXPECTED_BLOCK" }, { ref: "osa.conversation.record.v1", result: "PASS_SERVICE_AUTH_GATE_ONLY" });
  report.executor_inventory = execution.registry.refs();
  report.memory = await (await fetch(base + "/memory/status")).json();
  report.platform = await (await fetch(base + "/platform/status")).json();
  report.intelligence = (await (await fetch(base + "/intelligence")).json()).map(m => ({ id: m.id, status: m.status }));
  const dir = path.resolve(__dirname, "../artifacts/product-audit");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "local-http.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ routes: report.routes.length, native_tool_flows: 3, negative_tool_gates: 2, executors: report.executor_inventory.length, result: "PASS", paid_calls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
