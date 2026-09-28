import { ProviderConfigError } from "./provider";

export type ProviderId = "anthropic";

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  api_key: string;
  base_url: string;
  timeout_ms: number;
  max_tokens: number;
}

type Env = Record<string, string | undefined>;

const PROVIDERS: Record<ProviderId, { key_var: string; base_url: string }> = {
  anthropic: { key_var: "ANTHROPIC_API_KEY", base_url: "https://api.anthropic.com" },
};

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ProviderConfigError(`${name} is required in provider mode`);
  return value;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProviderConfigError(`${name} must be a positive integer`);
  }
  return value;
}

// Fails closed: no implicit provider, no implicit model, no implicit credentials.
export function loadProviderConfig(env: Env): ProviderConfig {
  const provider = required(env, "OSA_PROVIDER");
  if (!(provider in PROVIDERS)) {
    throw new ProviderConfigError(
      `OSA_PROVIDER must be one of: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }
  const spec = PROVIDERS[provider as ProviderId];

  return {
    provider: provider as ProviderId,
    model: required(env, "OSA_MODEL"),
    api_key: required(env, spec.key_var),
    base_url: (env.OSA_PROVIDER_BASE_URL?.trim() || spec.base_url).replace(/\/+$/, ""),
    timeout_ms: positiveInt(env, "OSA_PROVIDER_TIMEOUT_MS", 120_000),
    max_tokens: positiveInt(env, "OSA_PROVIDER_MAX_TOKENS", 16_000),
  };
}
