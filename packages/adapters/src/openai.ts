import { ProviderConfig } from "./config";
import { asNumber, httpError, postJson, redactedError, sha256 } from "./http";
import {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderCallError,
  redactSecret,
} from "./provider";

interface ChatCompletion {
  id?: unknown;
  model?: unknown;
  choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

// Minimal OpenAI Chat Completions adapter over native fetch, with strict JSON-schema structured output.
// Same boundary as AnthropicProvider: one attempt per call, normalized ModelResponse, redacted errors.
export class OpenAIProvider implements ModelProvider {
  readonly id = "openai";
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
      max_completion_tokens: this.config.max_tokens,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "osa_output", strict: true, schema: request.output_schema },
      },
    });

    const response = await postJson({
      provider: this.id,
      url: `${this.config.base_url}/v1/chat/completions`,
      headers: { authorization: `Bearer ${this.config.api_key}` },
      body,
      timeoutMs: this.config.timeout_ms,
    });

    if (response.status < 200 || response.status >= 300) throw httpError(this.id, response);

    let completion: ChatCompletion;
    try {
      completion = JSON.parse(response.raw) as ChatCompletion;
    } catch {
      throw new ProviderCallError("openai response body is not valid JSON");
    }

    const choice = Array.isArray(completion.choices) ? completion.choices[0] : undefined;
    if (!choice) throw new ProviderCallError("openai response contained no choices");
    if (choice.finish_reason !== "stop") {
      throw new ProviderCallError(`openai call did not complete (finish_reason=${String(choice.finish_reason)})`);
    }
    if (typeof choice.message?.refusal === "string" && choice.message.refusal) {
      throw new ProviderCallError("openai call was refused by the model");
    }
    const text = typeof choice.message?.content === "string" ? choice.message.content : "";
    if (!text) throw new ProviderCallError("openai response contained no text content");

    return {
      provider: this.id,
      model: typeof completion.model === "string" ? completion.model : this.config.model,
      response_id: typeof completion.id === "string" ? completion.id : "",
      http_status: response.status,
      stop_reason: choice.finish_reason,
      text,
      usage: {
        input_tokens: asNumber(completion.usage?.prompt_tokens),
        output_tokens: asNumber(completion.usage?.completion_tokens),
      },
      latency_ms: response.latency_ms,
      request_sha256: sha256(body),
      response_sha256: sha256(response.raw),
    };
  }
}
