import { randomUUID } from "node:crypto";

/** Operational telemetry only. Never accepts arbitrary HTTP bodies, prompts, headers or evidence. */
export type TelemetryComponent = "api" | "worker" | "runtime" | "fleet";
export interface TelemetryRecord {
  component: TelemetryComponent;
  event: string;
  level?: "INFO" | "WARN" | "ERROR";
  execution_id?: string;
  run_id?: string;
  mission_id?: string;
  request_id?: string;
  method?: string;
  status_code?: number;
  duration_ms?: number;
  outcome?: string;
  error_code?: string;
}
export type TelemetrySink = (line: string) => void;
export const EXECUTION_ID_PATTERN = /^exec_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function validExecutionId(candidate: unknown): string | undefined {
  return typeof candidate === "string" && EXECUTION_ID_PATTERN.test(candidate) ? candidate : undefined;
}

export function redactTelemetry(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED]")
    .replace(/\bBearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]")
    .replace(/\b((?:authorization|cookie|set-cookie|password|passwd|secret|client_secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi, "$1[REDACTED]");
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
}
function safeEvent(value: unknown): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : "UNKNOWN_EVENT";
}

/** Fixed-schema allowlist: no freeform metadata, exceptions, URLs, token values or model outputs. */
export function telemetryLine(record: TelemetryRecord, now = new Date()): string {
  const fields = {
    schema: "osa.telemetry.v1",
    timestamp: now.toISOString(),
    level: record.level ?? "INFO",
    component: record.component,
    event: safeEvent(record.event),
    ...(validExecutionId(record.execution_id) ? { execution_id: record.execution_id } : {}),
    ...(safeId(record.run_id) ? { run_id: record.run_id } : {}),
    ...(safeId(record.mission_id) ? { mission_id: record.mission_id } : {}),
    ...(safeId(record.request_id) ? { request_id: record.request_id } : {}),
    ...(["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"].includes(record.method ?? "") ? { method: record.method } : {}),
    ...(Number.isInteger(record.status_code) && (record.status_code ?? 0) >= 100 && (record.status_code ?? 0) <= 599 ? { status_code: record.status_code } : {}),
    ...(Number.isFinite(record.duration_ms) && (record.duration_ms ?? -1) >= 0 ? { duration_ms: Math.round(record.duration_ms!) } : {}),
    ...(safeId(record.outcome) ? { outcome: record.outcome } : {}),
    ...(safeId(record.error_code) ? { error_code: record.error_code } : {}),
  };
  return redactTelemetry(JSON.stringify(fields));
}

export function emitTelemetry(record: TelemetryRecord, sink: TelemetrySink = line => process.stdout.write(line + "\n")): void {
  // Telemetry cannot change execution verdicts, authorization or evidence.
  try { sink(telemetryLine(record)); } catch { /* fail independent of execution */ }
}

export function observeHttpRequest(
  request: { method?: string; headers: Record<string, string | string[] | undefined> },
  response: { statusCode: number; getHeader(name: string): number | string | string[] | undefined; once(event: "finish", listener: () => void): unknown },
  component: "api" | "worker",
  sink?: TelemetrySink,
): void {
  const start = process.hrtime.bigint();
  const request_id = "req_" + randomUUID();
  const header = request.headers["x-osa-execution-id"];
  const inbound = validExecutionId(Array.isArray(header) ? undefined : header);
  response.once("finish", () => {
    const h = response.getHeader("x-osa-execution-id");
    const execution_id = validExecutionId(typeof h === "string" ? h : undefined) ?? inbound;
    emitTelemetry({ component, event: "HTTP_REQUEST_FINISHED", request_id, execution_id,
      method: request.method, status_code: response.statusCode,
      duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
      level: response.statusCode >= 500 ? "ERROR" : response.statusCode >= 400 ? "WARN" : "INFO" }, sink);
  });
}
