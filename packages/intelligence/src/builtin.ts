import {
  createModelProvider,
  createProviderBuilderExecutor,
  loadMeshConfig,
  loadProviderConfig,
  ModelMesh,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderCallError,
  ProviderConfigError,
  redactSecret,
  RetryingProvider,
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
  version: "0.2.0",
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
        // Each supported provider must be selectable by configuration alone and route to its own adapter.
        const keyVar: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };
        const routed = SUPPORTED_PROVIDERS.map((provider) => {
          const config = loadProviderConfig({ OSA_PROVIDER: provider, OSA_MODEL: "sample-model", [keyVar[provider]]: "sample-key" });
          return createModelProvider(config).id === provider ? provider : `${provider}!`;
        });
        const ok = SUPPORTED_PROVIDERS.length >= 2 && routed.every((id) => !id.endsWith("!"));
        return { ok, detail: `routes by OSA_PROVIDER to: ${routed.join(", ")}` };
      },
    },
    {
      proof_id: "calls.bounded_retries",
      run: async () => {
        const probe = async (failures: ProviderCallError[], maxRetries: number) => {
          let calls = 0;
          const inner: ModelProvider = {
            id: "probe",
            model: "probe",
            complete: async (_request: ModelRequest): Promise<ModelResponse> => {
              calls += 1;
              const failure = failures[calls - 1];
              if (failure) throw failure;
              return { provider: "probe", model: "probe", response_id: "r", http_status: 200, stop_reason: "end_turn", text: "{}", usage: {}, latency_ms: 0, request_sha256: "", response_sha256: "" };
            },
          };
          const provider = new RetryingProvider(inner, { maxRetries, sleep: async () => undefined });
          try {
            const response = await provider.complete({ system: "", prompt: "", output_schema: {} });
            return { calls, ok: true, attempts: response.attempts };
          } catch {
            return { calls, ok: false, attempts: undefined };
          }
        };
        const retryable = () => new ProviderCallError("HTTP 429", { retryable: true, status: 429 });
        const recovers = await probe([retryable(), retryable()], 2);
        const exhausted = await probe([retryable(), retryable(), retryable(), retryable()], 2);
        const fatal = await probe([new ProviderCallError("HTTP 400", { status: 400 })], 2);
        const ok = recovers.ok && recovers.attempts === 3 && !exhausted.ok && exhausted.calls === 3 && !fatal.ok && fatal.calls === 1;
        return {
          ok,
          detail: `recovers after 2 retryable failures (${recovers.calls} calls); stops at ${exhausted.calls} calls; non-retryable stops at ${fatal.calls}`,
        };
      },
    },
  ],
};

// Fake gateway targets for mesh self-tests: `fail` throws a provider error, otherwise returns `text`.
function target(id: string, outcome: { fail?: string; text?: string }): ModelProvider {
  return {
    id,
    model: `${id}-model`,
    complete: async (): Promise<ModelResponse> => {
      if (outcome.fail) throw new ProviderCallError(outcome.fail, { retryable: false, attempts: 3 });
      return { provider: id, model: `${id}-model`, response_id: "r", http_status: 200, stop_reason: "end_turn", text: outcome.text ?? "{}", usage: {}, latency_ms: 0, request_sha256: "", response_sha256: "", attempts: 1 };
    },
  };
}

export const modelMeshModule: ModuleImplementation = {
  id: "model-mesh",
  version: "0.1.0",
  checks: [
    {
      proof_id: "mesh.fallback_on_failure",
      run: async () => {
        const request = { system: "", prompt: "", output_schema: {} };
        const served = await new ModelMesh([target("primary", { fail: "HTTP 503" }), target("backup", {})]).complete(request);
        let exhausted = "";
        try {
          await new ModelMesh([target("a", { fail: "HTTP 500" }), target("b", { fail: "HTTP 429" })]).complete(request);
        } catch (error) {
          exhausted = error instanceof ProviderCallError ? error.message : "wrong error type";
        }
        let bugSurfaced = false;
        try {
          await new ModelMesh([{ id: "bug", model: "m", complete: async () => { throw new TypeError("bug"); } }, target("backup", {})]).complete(request);
        } catch (error) {
          bugSurfaced = error instanceof TypeError;
        }
        const configOk = loadMeshConfig({ OSA_PROVIDER: "anthropic", OSA_MODEL: "a", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", OSA_MODEL_FALLBACKS: "openai:b" }).length === 2
          && throwsConfigError(() => loadMeshConfig({ OSA_PROVIDER: "anthropic", OSA_MODEL: "a", ANTHROPIC_API_KEY: "k", OSA_MODEL_FALLBACKS: "openai:b" }), "OPENAI_API_KEY");
        const ok = served.provider === "backup" && /exhausted 2 targets/.test(exhausted) && bugSurfaced && configOk;
        return { ok, detail: `served by ${served.provider} after primary failed; exhausted: "${exhausted.slice(0, 60)}"; bugs surface: ${bugSurfaced}; fallback keys required: ${configOk}` };
      },
    },
    {
      proof_id: "mesh.evidence_per_hop",
      run: async () => {
        const artifact = JSON.stringify({ title: "t", content: "c" });
        const mesh = new ModelMesh([target("primary", { fail: "HTTP 503" }), target("backup", { text: artifact })]);
        const result = await createProviderBuilderExecutor(mesh)({
          run_id: "r", execution_id: "e", operation_id: "o",
          mission: { objective: "o" } as never,
          agent: { agent_id: "builder", role: "builder", executor_ref: "x" },
          input: { plan: { summary: "s", steps: ["a"] } },
        });
        const call = result.evidence.find((e) => e.kind === "provider_call");
        const hops = (call?.data.hops ?? []) as Array<{ provider: string; ok: boolean; attempts: number; error?: string }>;
        const ok = hops.length === 2 && hops[0].provider === "primary" && !hops[0].ok && hops[0].attempts === 3 && hops[0].error === "HTTP 503"
          && hops[1].provider === "backup" && hops[1].ok && call?.data.provider === "backup";
        return { ok, detail: `provider_call.hops = ${hops.map((h) => `${h.provider}:${h.ok ? "ok" : "failed"}`).join(" -> ") || "missing"}` };
      },
    },
  ],
};

export function createBuiltinIntelligence(clock?: () => Date): IntelligenceRegistry {
  const registry = new IntelligenceRegistry(clock);
  registry.register(modelsModule);
  registry.register(llmGatewayModule);
  registry.register(modelMeshModule);
  return registry;
}
