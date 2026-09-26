import { createHash } from "node:crypto";
import { ProviderConfig } from "./config";
import {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderCallError,
  redactSecret,
} from "./provider";

const ANTHROPIC_VERSION = "2023-06-01";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface AnthropicMessage {
  id?: unknown;
  model?: unknown;
  stop_reason?: unknown;
  content?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Minimal Anthropic Messages API adapter over native fetch (no SDK dependency).
export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly model: string;

  constructor(private readonly config: ProviderConfig) {
    this.model = config.model;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.call(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderCallError(redactSecret(message, this.config.api_key));
    }
  }

  private async call(request: ModelRequest): Promise<ModelResponse> {
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: this.config.max_tokens,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      output_config: { format: { type: "json_schema", schema: request.output_schema } },
    });

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.config.base_url}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.api_key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body,
        signal: AbortSignal.timeout(this.config.timeout_ms),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error(`anthropic request timed out after ${this.config.timeout_ms}ms`);
      }
      throw new Error(`anthropic request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const raw = await response.text();
    const latency = Date.now() - started;

    if (!response.ok) {
      let errorType = "unknown_error";
      try {
        const parsed = JSON.parse(raw) as { error?: { type?: unknown } };
        if (typeof parsed.error?.type === "string") errorType = parsed.error.type;
      } catch {
        // non-JSON error body: keep status only
      }
      throw new Error(`anthropic HTTP ${response.status} (${errorType})`);
    }

    let message: AnthropicMessage;
    try {
      message = JSON.parse(raw) as AnthropicMessage;
    } catch {
      throw new Error("anthropic response body is not valid JSON");
    }

    if (message.stop_reason !== "end_turn") {
      throw new Error(`anthropic call did not complete (stop_reason=${String(message.stop_reason)})`);
    }

    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((block): block is { type: "text"; text: string } =>
        !!block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    if (!text) throw new Error("anthropic response contained no text content");

    return {
      provider: this.id,
      model: typeof message.model === "string" ? message.model : this.config.model,
      response_id: typeof message.id === "string" ? message.id : "",
      http_status: response.status,
      stop_reason: message.stop_reason,
      text,
      usage: {
        input_tokens: asNumber(message.usage?.input_tokens),
        output_tokens: asNumber(message.usage?.output_tokens),
      },
      latency_ms: latency,
      request_sha256: sha256(body),
      response_sha256: sha256(raw),
    };
  }
}
