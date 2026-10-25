import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { emitTelemetry, observeHttpRequest, redactTelemetry, telemetryLine, validExecutionId } from "../packages/telemetry/src";

const EXEC = "exec_12345678-1234-4123-8123-123456789abc";

test("telemetry: stable schema, execution correlation, fixed fields and no arbitrary payload", () => {
  const line = telemetryLine({component: "runtime", event: "RUNTIME_EVENT", execution_id: EXEC,
    run_id: "run_123", mission_id: "mission_1", outcome:"RUN_STARTED"}, new Date("2026-10-25T12:00:00Z"));
  const data = JSON.parse(line);
  assert.equal(data.schema, "osa.telemetry.v1");
  assert.equal(data.execution_id, EXEC);
  assert.equal(data.timestamp, "2026-10-25T12:00:00.000Z");
  assert.equal(data.outcome, "RUN_STARTED");
  assert.equal("payload" in data, false);
  assert.equal(validExecutionId("exec_123"), undefined);
});

test("telemetry: redacts authorization, bearer, cookies, API keys and private key PEMs", () => {
  const leaked = 'Authorization: Bearer abc.def Cookie: abc API_KEY=abc123 password=pass123';
  const safe = redactTelemetry(leaked + "\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----");
  for (const secret of ["abc.def", "abc123", "pass123", "BEGIN PRIVATE KEY", "secret\n"]) {
    assert.equal(safe.includes(secret), false, secret);
  }
  assert.match(safe, /REDACTED/);
});

test("telemetry: hostile IDs, messages and injected fields are never logged", () => {
  const secret = "top-secret";
  const value = telemetryLine({component:"api",event:"HTTP_REQUEST_FINISHED",
    execution_id:"exec_BAD_KEY=top-secret",error_code:"Bearer " + secret,
    mission_id:"mission\napi_key=" + secret} as never);
  assert.ok(!value.includes(secret), value);
  assert.equal(JSON.parse(value).event, "HTTP_REQUEST_FINISHED");
});

test("telemetry: sink failures cannot break runtime", () => {
  assert.doesNotThrow(() => emitTelemetry({component:"runtime",event:"RUNTIME_EVENT"},
    () => { throw Error("sink unavailable"); }));
});

test("telemetry: HTTP completion prefers response execution ID and never logs headers", () => {
  class FakeResponse extends EventEmitter {
    statusCode = 201;
    private headers = new Map<string,string>();
    getHeader(name:string) { return this.headers.get(name); }
    setHeader(name:string,value:string) { this.headers.set(name,value); }
  }
  const response = new FakeResponse();
  const lines:string[] = [];
  observeHttpRequest({method:"POST",headers:{"x-osa-execution-id":EXEC, authorization:"Bearer hidden"}},
    response,"api",line=>lines.push(line));
  const actual = "exec_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  response.setHeader("x-osa-execution-id",actual);
  response.emit("finish");
  assert.equal(lines.length,1);
  const data=JSON.parse(lines[0]);
  assert.equal(data.execution_id,actual);
  assert.equal(data.method,"POST");
  assert.equal(data.status_code,201);
  assert.ok(data.duration_ms>=0);
  assert.equal(lines[0].includes("hidden"),false);
});
