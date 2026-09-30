import { ModelProvider, ModelRequest, ModelResponse, ProviderCallError } from "./provider";

export interface RetryOptions {
  // Retries after the first attempt (total attempts = maxRetries + 1). SDK default: 2.
  maxRetries: number;
  // First backoff step; doubles per retry up to maxDelayMs. SDK default: 500 ms.
  baseDelayMs?: number;
  maxDelayMs?: number;
  // Cap for server-provided retry-after values. SDK default: 60 s.
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Delay before retry number `retry` (0-based), following the official SDKs:
// honour retry-after when present (capped), else min(base * 2^retry, max) with up to 25% jitter.
export function retryDelayMs(retry: number, error: ProviderCallError, options: RetryOptions): number {
  const maxRetryAfter = options.maxRetryAfterMs ?? 60_000;
  if (error.retryAfterMs !== undefined && error.retryAfterMs >= 0 && error.retryAfterMs <= maxRetryAfter) {
    return error.retryAfterMs;
  }
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 8_000;
  const jitter = 1 - (options.random ?? Math.random)() * 0.25;
  return Math.min(base * 2 ** retry, max) * jitter;
}

// Bounded retries around one provider. Only retryable ProviderCallErrors are retried; everything else
// (bad request, auth, refused or incomplete output, invalid body) fails on the first attempt.
export class RetryingProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;

  constructor(private readonly inner: ModelProvider, private readonly options: RetryOptions) {
    if (!Number.isInteger(options.maxRetries) || options.maxRetries < 0) {
      throw new RangeError("maxRetries must be a non-negative integer");
    }
    this.id = inner.id;
    this.model = inner.model;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const sleep = this.options.sleep ?? defaultSleep;
    const failures: ProviderCallError[] = [];
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.inner.complete(request);
        return { ...response, attempts: attempt };
      } catch (error) {
        if (!(error instanceof ProviderCallError)) throw error;
        failures.push(error);
        const retriesLeft = this.options.maxRetries - (attempt - 1);
        if (!error.retryable || retriesLeft <= 0) {
          if (failures.length === 1) {
            throw new ProviderCallError(error.message, { retryable: error.retryable, status: error.status, retryAfterMs: error.retryAfterMs, attempts: 1 });
          }
          throw new ProviderCallError(
            `${this.id} failed after ${failures.length} attempts: ${failures.map((f) => f.message).join("; ")}`,
            { retryable: false, status: error.status, attempts: failures.length }
          );
        }
        await sleep(retryDelayMs(attempt - 1, error, this.options));
      }
    }
  }
}
