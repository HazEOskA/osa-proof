import { AnthropicProvider } from "./anthropic";
import { ProviderConfig } from "./config";
import { OpenAIProvider } from "./openai";
import { ModelProvider } from "./provider";
import { RetryingProvider, RetryOptions } from "./retry";

export * from "./provider";
export * from "./config";
export * from "./executors";
export { AnthropicProvider } from "./anthropic";
export { OpenAIProvider } from "./openai";
export { RetryingProvider, retryDelayMs } from "./retry";
export type { RetryOptions } from "./retry";
export { isRetryableStatus, retryAfterMs } from "./http";

// LLM gateway entry point: routes to the configured provider and wraps it in bounded retries.
export function createModelProvider(
  config: ProviderConfig,
  retry: Pick<RetryOptions, "sleep" | "random"> = {}
): ModelProvider {
  let inner: ModelProvider;
  switch (config.provider) {
    case "anthropic":
      inner = new AnthropicProvider(config);
      break;
    case "openai":
      inner = new OpenAIProvider(config);
      break;
  }
  return new RetryingProvider(inner, { maxRetries: config.max_retries, baseDelayMs: config.retry_base_ms, ...retry });
}
