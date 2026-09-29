import { createHash } from "node:crypto";
import { ProviderCallError } from "./provider";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface JsonHttpResponse {
  status: number;
  raw: string;
  headers: Headers;
  latency_ms: number;
}

// One HTTP attempt. Connection failures and timeouts are retryable, as in the official SDKs.
export async function postJson(params: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<JsonHttpResponse> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...params.headers },
      body: params.body,
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new ProviderCallError(`${params.provider} request timed out after ${params.timeoutMs}ms`, { retryable: true });
    }
    throw new ProviderCallError(
      `${params.provider} request failed: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true }
    );
  }
  const raw = await response.text();
  return { status: response.status, raw, headers: response.headers, latency_ms: Date.now() - started };
}

// Retry rule of the official OpenAI / Anthropic SDKs: x-should-retry wins; else 408, 409, 429, >=500.
export function isRetryableStatus(status: number, headers: Headers): boolean {
  const hint = headers.get("x-should-retry");
  if (hint === "true") return true;
  if (hint === "false") return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

// Server-provided delay: retry-after-ms, then retry-after (seconds or HTTP date).
export function retryAfterMs(headers: Headers): number | undefined {
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.get("retry-after-ms") !== null && Number.isFinite(ms) && ms >= 0) return ms;
  const value = headers.get("retry-after");
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function httpError(provider: string, response: JsonHttpResponse): ProviderCallError {
  let errorType = "unknown_error";
  try {
    const parsed = JSON.parse(response.raw) as { error?: { type?: unknown; code?: unknown } };
    const type = parsed.error?.type ?? parsed.error?.code;
    if (typeof type === "string" && type) errorType = type;
  } catch {
    // non-JSON error body: keep status only
  }
  return new ProviderCallError(`${provider} HTTP ${response.status} (${errorType})`, {
    status: response.status,
    retryable: isRetryableStatus(response.status, response.headers),
    retryAfterMs: retryAfterMs(response.headers),
  });
}

// Re-throws any error as a ProviderCallError with the secret removed, keeping its retry metadata.
export function redactedError(error: unknown, redact: (message: string) => string): ProviderCallError {
  if (error instanceof ProviderCallError) {
    return new ProviderCallError(redact(error.message), {
      retryable: error.retryable,
      status: error.status,
      retryAfterMs: error.retryAfterMs,
    });
  }
  return new ProviderCallError(redact(error instanceof Error ? error.message : String(error)));
}
