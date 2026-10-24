import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";

test("HTTP body limit rejects oversized streamed JSON before modifying catalog; valid requests still work", async () => {
  const state = new ApiState(undefined, undefined, undefined, "open");
  const server = createApiServer(createDevFixtureRegistry(), state);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const oversized = await fetch(base + "/datasets", { method: "POST", body: JSON.stringify({ padding: "ą".repeat(2 * 1024 * 1024) }) });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json() as {code: string}).code, "BODY_TOO_LARGE");
    const invalid = await fetch(base + "/datasets", { method: "POST", body: '{"secret":' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "Nieprawidłowy JSON.", code: "INVALID_JSON" });
    const valid = await fetch(base + "/datasets", { method: "POST", body: JSON.stringify({ dataset_id: "body-test", name: "Body test", examples: [{ example_id: "one", objective: "Check body boundary", input: {}, requirements: [{ requirement_id: "ok", type: "evidence_field_equals", evidence_kind: "check", field: "ok", expected: true }] }] }) });
    assert.equal(valid.status, 201);
    const list = await fetch(base + "/datasets");
    assert.equal((await list.json() as unknown[]).length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
