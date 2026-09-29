import { ProviderConfig } from "./config";
import { asNumber, httpError, postJson, redactedError, sha256 } from "./http";
import {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderCallError,
  redactSecret,
} from "./provider";

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  id?: unknown;
  model?: unknown;
  stop_reason?: unknown;
  content?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

// Minimal Anthropic Messages API adapter over native fetch (no SDK dependency). One attempt per call;
// retries belong to RetryingProvider.
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
      throw redactedError(error, (message) => redactSecret(message, this.config.api_key));
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

    const response = await postJson({
      provider: this.id,
      url: `${this.config.base_url}/v1/messages`,
      headers: { "x-api-key": this.config.api_key, "anthropic-version": ANTHROPIC_VERSION },
      body,
      timeoutMs: this.config.timeout_ms,
    });

    if (response.status < 200 || response.status >= 300) throw httpError(this.id, response);

    let message: AnthropicMessage;
    try {
      message = JSON.parse(response.raw) as AnthropicMessage;
    } catch {
      throw new ProviderCallError("anthropic response body is not valid JSON");
    }

    if (message.stop_reason !== "end_turn") {
      throw new ProviderCallError(`anthropic call did not complete (stop_reason=${String(message.stop_reason)})`);
    }

    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
      .filter((block): block is { type: "text"; text: string } =>
        !!block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    if (!text) throw new ProviderCallError("anthropic response contained no text content");

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
      latency_ms: response.latency_ms,
      request_sha256: sha256(body),
      response_sha256: sha256(response.raw),
    };
  }
}
