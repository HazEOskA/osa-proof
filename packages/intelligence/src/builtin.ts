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
import { DatasetStore, ExampleInput, verifyDatasetVersion } from "../../datasets/src";
import { EvaluationObservation, EvaluatorStore, observationMatchesRun, verifyEvaluationObservation } from "../../evaluators/src";
import { ExecutorRegistry, OsaRuntime } from "../../runtime/src";
import { ExperimentError, ExperimentStore, verifyExperiment } from "../../experiments/src";
import { TeamGraph } from "../../contracts/src";
import { RunResult } from "../../contracts/src";
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

function sampleExample(id: string, objective: string): ExampleInput {
  return {
    example_id: id,
    objective,
    input: { request: objective },
    requirements: [{ requirement_id: "artifact_status", type: "evidence_field_equals", evidence_kind: "artifact", agent_id: "builder", field: "status", expected: "built" }],
    expected: { verdict: "VERIFIED" },
    split: "test",
  };
}

export const datasetsModule: ModuleImplementation = {
  id: "datasets",
  version: "0.1.0",
  checks: [
    {
      proof_id: "datasets.versioned",
      run: () => {
        const store = new DatasetStore(() => new Date("2026-01-01T00:00:00Z"));
        const v1 = store.create({ dataset_id: "probe", name: "Probe", examples: [sampleExample("a", "first")] });
        const v2 = store.commit("probe", { upsert: [sampleExample("b", "second")] });
        const v3 = store.commit("probe", { remove: ["a"] });
        store.tag("probe", "baseline", 1);
        const pinned = store.get("probe", "baseline");
        let noop = false;
        try { store.commit("probe", { upsert: [sampleExample("b", "second")] }); } catch { noop = true; }
        const ok = v1.version === 1 && v2.version === 2 && v2.parent_version === 1 && v3.version === 3
          && pinned.examples.length === 1 && pinned.examples[0].example_id === "a" && pinned.version_sha256 === v1.version_sha256
          && store.get("probe").examples.map((e) => e.example_id).join() === "b" && noop;
        return { ok, detail: `v1..v3 immutable; tag 'baseline' pins v1; no-op commit refused: ${noop}` };
      },
    },
    {
      proof_id: "datasets.content_digests",
      run: () => {
        const a = new DatasetStore(() => new Date("2026-01-01T00:00:00Z")).create({ dataset_id: "d", name: "D", examples: [sampleExample("x", "1"), sampleExample("y", "2")] });
        const b = new DatasetStore(() => new Date("2026-01-01T00:00:00Z")).create({ dataset_id: "d", name: "D", examples: [sampleExample("y", "2"), sampleExample("x", "1")] });
        const clean = verifyDatasetVersion(a).ok;
        const tampered = structuredClone(a);
        (tampered.examples[0] as { objective: string }).objective = "forged";
        const caught = !verifyDatasetVersion(tampered).ok;
        const ok = clean && caught && a.examples_root === b.examples_root && a.version_sha256 === b.version_sha256;
        return { ok, detail: `order-independent root: ${a.examples_root === b.examples_root}; verifies: ${clean}; tamper caught: ${caught}` };
      },
    },
  ],
};

// A real run through the runtime with in-process fixture executors: the evaluator checks score an actual sealed receipt.
async function probeRun(): Promise<RunResult> {
  const registry = new ExecutorRegistry();
  registry.register("probe.planner", ({ mission }) => ({ output: { plan: mission.objective }, evidence: [{ kind: "plan", data: { status: "ready" } }] }));
  registry.register("probe.builder", () => ({ output: { title: "Release notes" }, evidence: [{ kind: "artifact", data: { status: "built" } }] }));
  const graph = {
    organization_id: "org_probe", project_id: "project_probe", team_id: "team_probe", version: "1",
    agents: [{ agent_id: "planner", role: "planner", executor_ref: "probe.planner" }, { agent_id: "builder", role: "builder", executor_ref: "probe.builder" }],
    edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" as const }],
  };
  const example = sampleExample("probe", "Draft release notes");
  return new OsaRuntime(registry).run(graph, {
    organization_id: "org_probe", project_id: "project_probe", mission_id: "probe@v1:probe", team_id: "team_probe", team_version: "1",
    objective: example.objective, entry_agent_id: "planner", input: example.input, requirements: example.requirements,
  });
}

function probeEvaluators(): EvaluatorStore {
  const store = new EvaluatorStore(() => new Date("2026-01-01T00:00:00Z"));
  store.register({ evaluator_id: "receipt", spec: { type: "receipt_valid" } });
  store.register({ evaluator_id: "title", spec: { type: "string_check", path: "title", operation: "ilike", reference: "release" } });
  store.register({ evaluator_id: "built", spec: { type: "evidence_equals", evidence_kind: "artifact", field: "status", expected: "built" } });
  store.register({ evaluator_id: "review", spec: { type: "human_label", choices: [0, 0.5, 1] }, pass_threshold: 0.5 });
  return store;
}

const DETERMINISTIC_IDS = ["receipt", "title", "built"];

export const evaluatorsModule: ModuleImplementation = {
  id: "evaluators",
  version: "0.1.0",
  checks: [
    {
      proof_id: "evaluators.deterministic_or_labeled",
      run: async () => {
        const run = await probeRun();
        const first = probeEvaluators().evaluate(run, DETERMINISTIC_IDS);
        const second = probeEvaluators().evaluate(run, DETERMINISTIC_IDS);
        const repeatable = first.map((o) => o.observation_sha256).join() === second.map((o) => o.observation_sha256).join();
        const allPass = first.every((o) => o.score === 1 && o.passed);
        let judgeRefused = false;
        try { probeEvaluators().register({ evaluator_id: "judge", spec: { type: "llm_judge" } as never }); } catch { judgeRefused = true; }
        let badLabelRefused = false;
        try { probeEvaluators().label(run, { evaluator_id: "review", labeler: "ops", score: 0.7 }); } catch { badLabelRefused = true; }
        const label = probeEvaluators().label(run, { evaluator_id: "review", labeler: "ops", score: 1 });
        const ok = repeatable && allPass && judgeRefused && badLabelRefused && label.provenance === "HUMAN_LABEL" && label.passed;
        return { ok, detail: `same run, same scores: ${repeatable}; model judge refused: ${judgeRefused}; label off-scale refused: ${badLabelRefused}` };
      },
    },
    {
      proof_id: "evaluators.results_as_observations",
      run: async () => {
        const run = await probeRun();
        const results = probeEvaluators().evaluate(run, DETERMINISTIC_IDS);
        const bound = results.every((o) => o.provenance === "VERIFIER_OBSERVATION" && observationMatchesRun(o, run) && verifyEvaluationObservation(o).ok);
        const forged = structuredClone(results[0]) as EvaluationObservation;
        forged.score = 0;
        const forgeryCaught = !verifyEvaluationObservation(forged).ok;
        const tampered = structuredClone(run);
        (tampered.final_output as { title: string }).title = "forged";
        const failClosed = probeEvaluators().evaluate(tampered, DETERMINISTIC_IDS).every((o) => o.score === 0 && !o.passed);
        const receiptUntouched = run.proof.proof_id === `proof_${run.proof.receipt_sha256}`;
        const ok = bound && forgeryCaught && failClosed && receiptUntouched;
        return { ok, detail: `bound to receipt: ${bound}; forged score caught: ${forgeryCaught}; tampered run scores 0: ${failClosed}` };
      },
    },
  ],
};

// Experiments probe: two examples, two team versions whose builders differ (built vs draft), real runtime.
function probeExperimentWorld() {
  const registry = new ExecutorRegistry();
  registry.register("probe.planner", ({ mission }) => ({ output: { plan: mission.objective }, evidence: [{ kind: "plan", data: { status: "ready" } }] }));
  registry.register("probe.builder", () => ({ output: { title: "Release notes" }, evidence: [{ kind: "artifact", data: { status: "built" } }] }));
  registry.register("probe.builder.draft", () => ({ output: { title: "Draft" }, evidence: [{ kind: "artifact", data: { status: "draft" } }] }));
  const runtime = new OsaRuntime(registry);
  const graph = (version: string, builder: string): TeamGraph => ({
    organization_id: "org_probe", project_id: "project_probe", team_id: "team_probe", version,
    agents: [{ agent_id: "planner", role: "planner", executor_ref: "probe.planner" }, { agent_id: "builder", role: "builder", executor_ref: builder }],
    edges: [{ edge_id: "p_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
  });
  const datasets = new DatasetStore(() => new Date("2026-01-01T00:00:00Z"));
  const v1 = datasets.create({ dataset_id: "probe-exp", name: "Probe", examples: [sampleExample("a", "first"), sampleExample("b", "second")] });
  const v2 = datasets.commit("probe-exp", { upsert: [sampleExample("c", "third")] });
  const evaluators = new EvaluatorStore(() => new Date("2026-01-01T00:00:00Z"));
  evaluators.register({ evaluator_id: "verdict", spec: { type: "verdict_match" } });
  evaluators.register({ evaluator_id: "receipt", spec: { type: "receipt_valid" } });
  const run = (store: ExperimentStore, dataset: typeof v1, g: TeamGraph) =>
    store.run({ dataset, graph: g, evaluators, evaluator_ids: ["verdict", "receipt"], runMission: (gg, m) => runtime.run(gg, m) });
  return { graph, v1, v2, run };
}

export const experimentsModule: ModuleImplementation = {
  id: "experiments",
  version: "0.1.0",
  checks: [
    {
      proof_id: "experiments.reproducible",
      run: async () => {
        const w = probeExperimentWorld();
        const a = await w.run(new ExperimentStore(() => new Date("2026-01-01T00:00:00Z")), w.v1, w.graph("1", "probe.builder"));
        const b = await w.run(new ExperimentStore(() => new Date("2026-01-01T00:00:00Z")), w.v1, w.graph("1", "probe.builder"));
        const sealed = verifyExperiment(a).ok && verifyExperiment(b).ok;
        const receipts = a.results.every((r) => r.proof_id.startsWith("proof_")) && new Set(a.results.map((r) => r.run_id)).size === a.results.length;
        const ok = a.outcome_sha256 === b.outcome_sha256 && sealed && receipts && a.summary.verified === 2;
        return { ok, detail: `same pins, same outcome_sha256: ${a.outcome_sha256 === b.outcome_sha256}; sealed: ${sealed}; one receipt per example run: ${receipts}` };
      },
    },
    {
      proof_id: "experiments.receipts_compared",
      run: async () => {
        const w = probeExperimentWorld();
        const store = new ExperimentStore(() => new Date("2026-01-01T00:00:00Z"));
        const good = await w.run(store, w.v1, w.graph("1", "probe.builder"));
        const bad = await w.run(store, w.v1, w.graph("2", "probe.builder.draft"));
        const other = await w.run(store, w.v2, w.graph("1", "probe.builder"));
        const cmp = store.compare(good.experiment_id, bad.experiment_id);
        let refused = false;
        try { store.compare(good.experiment_id, other.experiment_id); } catch (e) { refused = e instanceof ExperimentError && e.code === "conflict"; }
        const regressions = cmp.changed.filter((c) => c.verdict?.a === "VERIFIED" && c.verdict?.b === "FAILED").length;
        const ok = !cmp.same_outcome && regressions === 2 && cmp.verified_delta === -2 && cmp.mean_score_deltas.verdict === -1 && refused;
        return { ok, detail: `v1→v2 regressions caught: ${regressions}/2; verdict score delta ${cmp.mean_score_deltas.verdict}; different dataset versions refused: ${refused}` };
      },
    },
  ],
};

export function createBuiltinIntelligence(clock?: () => Date): IntelligenceRegistry {
  const registry = new IntelligenceRegistry(clock);
  registry.register(modelsModule);
  registry.register(llmGatewayModule);
  registry.register(modelMeshModule);
  registry.register(datasetsModule);
  registry.register(evaluatorsModule);
  registry.register(experimentsModule);
  return registry;
}
