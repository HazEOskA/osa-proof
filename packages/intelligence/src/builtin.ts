import {
  loadProviderConfig,
  ProviderConfigError,
  redactSecret,
  SUPPORTED_PROVIDERS,
} from "../../adapters/src";
import { IntelligenceRegistry, ModuleImplementation } from "./index";

type Env = Record<string, string | undefined>;

// Models: which models are configured, read only from the environment, validated fail-closed.
export function listConfiguredModels(env: Env): Array<{ provider: string; model: string }> {
  const config = loadProviderConfig(env);
  return [{ provider: config.provider, model: config.model }];
}

function throwsConfigError(fn: () => unknown, mustMention: string): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return error instanceof ProviderConfigError && error.message.includes(mustMention);
  }
}

// Checks are self-contained: they use fixed sample environments, never the process env or real secrets.
const SAMPLE = { OSA_PROVIDER: "anthropic", OSA_MODEL: "sample-model", ANTHROPIC_API_KEY: "sample-key" };

const failsClosed = {
  proof_id: "config.fails_closed",
  run: () => {
    const ok = throwsConfigError(() => loadProviderConfig({ ...SAMPLE, OSA_MODEL: undefined }), "OSA_MODEL")
      && throwsConfigError(() => loadProviderConfig({ ...SAMPLE, ANTHROPIC_API_KEY: undefined }), "ANTHROPIC_API_KEY");
    return { ok, detail: ok ? "missing model or key refuses to load" : "config loaded without model or key" };
  },
};

export const modelsModule: ModuleImplementation = {
  id: "models",
  version: "0.1.0",
  checks: [
    failsClosed,
    {
      proof_id: "models.lists_configured",
      run: () => {
        const models = listConfiguredModels(SAMPLE);
        const ok = models.length === 1 && models[0].provider === "anthropic" && models[0].model === "sample-model";
        return { ok, detail: ok ? "configured model listed from environment" : `unexpected list: ${JSON.stringify(models)}` };
      },
    },
    {
      proof_id: "provider.rejects_unknown",
      run: () => {
        const ok = throwsConfigError(() => loadProviderConfig({ ...SAMPLE, OSA_PROVIDER: "unknown-provider" }), "OSA_PROVIDER");
        return { ok, detail: ok ? "unknown provider refused" : "unknown provider accepted" };
      },
    },
  ],
};

export const llmGatewayModule: ModuleImplementation = {
  id: "llm-gateway",
  version: "0.1.0",
  checks: [
    failsClosed,
    {
      proof_id: "errors.redact_secrets",
      run: () => {
        const ok = redactSecret("key=SAMPLE_SECRET failed", "SAMPLE_SECRET") === "key=[REDACTED] failed";
        return { ok, detail: ok ? "secrets are redacted from error text" : "secret leaked through redaction" };
      },
    },
    {
      proof_id: "routing.multi_provider",
      run: () => {
        const ok = SUPPORTED_PROVIDERS.length >= 2;
        return { ok, detail: `supported providers: ${SUPPORTED_PROVIDERS.join(", ")}` };
      },
    },
    {
      proof_id: "calls.bounded_retries",
      run: () => ({ ok: false, detail: "adapter makes a single attempt; no retry policy yet" }),
    },
  ],
};

export function createBuiltinIntelligence(clock?: () => Date): IntelligenceRegistry {
  const registry = new IntelligenceRegistry(clock);
  registry.register(modelsModule);
  registry.register(llmGatewayModule);
  return registry;
}
