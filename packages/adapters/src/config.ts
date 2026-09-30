import { ProviderConfigError } from "./provider";

export type ProviderId = "anthropic" | "openai";

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  api_key: string;
  base_url: string;
  timeout_ms: number;
  max_tokens: number;
  max_retries: number;
  retry_base_ms: number;
}

type Env = Record<string, string | undefined>;

const PROVIDERS: Record<ProviderId, { key_var: string; base_url: string }> = {
  anthropic: { key_var: "ANTHROPIC_API_KEY", base_url: "https://api.anthropic.com" },
  openai: { key_var: "OPENAI_API_KEY", base_url: "https://api.openai.com" },
};

export const SUPPORTED_PROVIDERS: readonly ProviderId[] = Object.keys(PROVIDERS) as ProviderId[];

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

function boundedInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProviderConfigError(`${name} must be an integer between ${min} and ${max}`);
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
    // Retry defaults match the official OpenAI / Anthropic SDKs: 2 retries, 500 ms first backoff.
    max_retries: boundedInt(env, "OSA_PROVIDER_MAX_RETRIES", 2, 0, 10),
    retry_base_ms: boundedInt(env, "OSA_PROVIDER_RETRY_BASE_MS", 500, 0, 60_000),
  };
}

export const MAX_MODEL_FALLBACKS = 4;

// Primary target plus ordered fallbacks from OSA_MODEL_FALLBACKS="provider:model,provider:model".
// Every fallback is validated like the primary (its provider key must be set); duplicates are refused.
export function loadMeshConfig(env: Env): ProviderConfig[] {
  const primary = loadProviderConfig(env);
  const raw = env.OSA_MODEL_FALLBACKS?.trim();
  if (!raw) return [primary];
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.length > MAX_MODEL_FALLBACKS) {
    throw new ProviderConfigError(`OSA_MODEL_FALLBACKS allows at most ${MAX_MODEL_FALLBACKS} entries`);
  }
  const targets = [primary];
  for (const entry of entries) {
    const split = entry.indexOf(":");
    const provider = split > 0 ? entry.slice(0, split).trim() : "";
    const model = split > 0 ? entry.slice(split + 1).trim() : "";
    if (!provider || !model) {
      throw new ProviderConfigError("OSA_MODEL_FALLBACKS entries must look like provider:model");
    }
    const config = loadProviderConfig({ ...env, OSA_PROVIDER: provider, OSA_MODEL: model });
    if (targets.some((t) => t.provider === config.provider && t.model === config.model)) {
      throw new ProviderConfigError(`OSA_MODEL_FALLBACKS repeats ${provider}:${model}`);
    }
    targets.push(config);
  }
  return targets;
}
