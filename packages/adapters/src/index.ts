import { AnthropicProvider } from "./anthropic";
import { ProviderConfig } from "./config";
import { ModelProvider } from "./provider";

export * from "./provider";
export * from "./config";
export * from "./executors";
export { AnthropicProvider } from "./anthropic";

export function createModelProvider(config: ProviderConfig): ModelProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config);
  }
}
