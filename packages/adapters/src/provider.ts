// Provider-neutral model boundary. Core packages never import a concrete provider.

export type JsonSchema = Record<string, unknown>;

export interface ModelRequest {
  system: string;
  prompt: string;
  output_schema: JsonSchema;
}

export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface ModelResponse {
  provider: string;
  model: string;
  response_id: string;
  http_status: number;
  stop_reason: string;
  text: string;
  usage: ModelUsage;
  latency_ms: number;
  request_sha256: string;
  response_sha256: string;
  // Attempts the gateway made for this call (1 = no retry). Set by RetryingProvider.
  attempts?: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export interface ProviderCallErrorOptions {
  // True for failures a retry can fix: connection errors, timeouts, 408, 409, 429, 5xx
  // (the default rule of the official OpenAI and Anthropic SDKs), unless x-should-retry says otherwise.
  retryable?: boolean;
  status?: number;
  retryAfterMs?: number;
}

export class ProviderCallError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: ProviderCallErrorOptions = {}) {
    super(message);
    this.name = "ProviderCallError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function redactSecret(message: string, secret: string | undefined): string {
  if (!secret) return message;
  return message.split(secret).join("[REDACTED]");
}
