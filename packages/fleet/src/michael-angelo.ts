import type { AgentExecutor } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { emitTelemetry } from "../../telemetry/src";

/**
 * Michael Angelo Runtime Backend Contract:
 * HazEOskA/michael-angelo-kernelxver5/RUNTIME_BACKEND_CONTRACT.md
 * External execution is OPTIONAL, requires explicit operator opt-in and is never retried.
 * Completed upstream state is self-reported; it is NOT independent proof of code execution.
 */
export const MICHAEL_ANGELO_EXECUTOR_REF = "michael-angelo.worker.v1";

export interface MichaelAngeloFleetOptions {
  baseUrl: string;
  token: string;
  mode?: "ARCHITECT" | "PAINTER";
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

function validateOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))))
    throw new Error("MICHAEL_ANGELO_ORIGIN_INVALID");
  return url.origin;
}
function upstreamId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value))
    throw new Error("MICHAEL_ANGELO_MISSION_ID_INVALID");
  return value;
}

export function createMichaelAngeloFleetExecutor(options: MichaelAngeloFleetOptions): AgentExecutor {
  const origin = validateOrigin(options.baseUrl);
  if (!options.token || options.token.length < 32) throw new Error("MICHAEL_ANGELO_TOKEN_REQUIRED");
  const timeoutMs = options.timeoutMs ?? 15000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000
    || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 10000)
    throw new Error("MICHAEL_ANGELO_TIMEOUT_INVALID");
  const fetcher = options.fetchImpl ?? fetch;
  const mode = options.mode ?? "ARCHITECT";

  async function request(path: string, executionId: string, deadline: number, body?: object): Promise<Record<string, unknown>> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("MICHAEL_ANGELO_TIMEOUT");
    let response: Response;
    try {
      response = await fetcher(origin + path, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, remaining)),
        headers: {
          "accept": "application/json",
          "authorization": "Bearer " + options.token,
          "x-osa-execution-id": executionId,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error("MICHAEL_ANGELO_TRANSPORT_FAILED"); }
    if (!response.ok) throw new Error("MICHAEL_ANGELO_HTTP_" + response.status);
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 65536) throw new Error("MICHAEL_ANGELO_RESPONSE_TOO_LARGE");
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new Error("MICHAEL_ANGELO_INVALID_JSON"); }
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("MICHAEL_ANGELO_INVALID_RESPONSE");
    return json as Record<string, unknown>;
  }
  return async (ctx) => {
    const deadline = Date.now() + timeoutMs;
    // No remote side effects unless health reports an operational runtime.
    const status = await request("/v1/status", ctx.execution_id, deadline);
    if (status.ok !== true) throw new Error("MICHAEL_ANGELO_NOT_READY");
    emitTelemetry({component:"fleet",event:"REMOTE_MISSION_DISPATCH",execution_id:ctx.execution_id,
      mission_id:ctx.mission.mission_id,run_id:ctx.run_id,outcome:"REQUESTED"});
    // No automatic retries: a timed-out creation may have committed remotely.
    const created = await request("/v1/missions", ctx.execution_id, deadline, {
      title: "OSA Fleet: " + ctx.mission.mission_id,
      objective: ctx.mission.objective,
      mode,
    });
    const id = upstreamId(created.id);
    await request("/v1/missions/" + id + "/transition", ctx.execution_id, deadline, {state:"QUEUED"});
    let latest: Record<string,unknown> = created;
    do {
      if (deadline - Date.now() <= 0) throw new Error("MICHAEL_ANGELO_TIMEOUT_NO_RETRY");
      latest = await request("/v1/missions/" + id, ctx.execution_id, deadline);
      if (latest.id !== id) throw new Error("MICHAEL_ANGELO_BINDING_MISMATCH");
      if (latest.state === "FAILED" || latest.state === "HARAKIRI" || latest.state === "CANCELLED")
        throw new Error("MICHAEL_ANGELO_REMOTE_" + latest.state);
      if (latest.state === "COMPLETED") break;
      if (!["CREATED","QUEUED","LEASED","RUNNING","VERIFYING"].includes(String(latest.state)))
        throw new Error("MICHAEL_ANGELO_STATE_INVALID");
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
    } while (true);
    // The upstream report is NOT a verified external execution proof.
    const result = {
      remote_mission_id: id,
      remote_state: "COMPLETED",
      remote_report_sha256: digest(latest),
      verification_scope: "REMOTE_SELF_REPORT_UNVERIFIED",
      execution_id: ctx.execution_id,
    };
    emitTelemetry({component:"fleet",event:"REMOTE_MISSION_COMPLETED",execution_id:ctx.execution_id,
      mission_id:ctx.mission.mission_id,run_id:ctx.run_id,outcome:"REMOTE_UNVERIFIED"});
    return {output: result, evidence:[{kind:"michael_angelo_remote_report", data:{
      status:"REMOTE_COMPLETED_UNVERIFIED", remote_mission_id:id,
      remote_report_sha256:result.remote_report_sha256,
      verification_scope:result.verification_scope,
      execution_id:ctx.execution_id,
    }}]};
  };
}

export function loadMichaelAngeloFleetOptions(env: Record<string,string|undefined>): MichaelAngeloFleetOptions | undefined {
  if (env.OSA_MICHAEL_ANGELO_ENABLED !== "true") return undefined;
  if (!env.OSA_MICHAEL_ANGELO_BASE_URL || !env.OSA_MICHAEL_ANGELO_TOKEN)
    throw new Error("MICHAEL_ANGELO_NOT_CONFIGURED");
  if (env.OSA_MICHAEL_ANGELO_MODE && !["ARCHITECT","PAINTER"].includes(env.OSA_MICHAEL_ANGELO_MODE))
    throw new Error("MICHAEL_ANGELO_MODE_INVALID");
  return {baseUrl:env.OSA_MICHAEL_ANGELO_BASE_URL,token:env.OSA_MICHAEL_ANGELO_TOKEN,
    mode:env.OSA_MICHAEL_ANGELO_MODE as "ARCHITECT"|"PAINTER"|undefined};
}
