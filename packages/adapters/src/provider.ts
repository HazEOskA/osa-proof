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

export class ProviderCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export function redactSecret(message: string, secret: string | undefined): string {
  if (!secret) return message;
  return message.split(secret).join("[REDACTED]");
}
