import { RunResult, RunVerdict, TeamGraph } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { DatasetVersion, missionFromExample, verifyDatasetVersion } from "../../datasets/src";
import { EvaluatorStore } from "../../evaluators/src";
import { validateTeamGraph } from "../../team-graph/src";

// Experiments: run every example of a pinned dataset version against one Team Graph version, score each run
// with evaluators, and seal the outcome (LangSmith / Braintrust experiments, OSA proof semantics).
//
// Rules:
// 1. Inputs are pinned by digest: dataset version_sha256, graph_sha256, and each evaluator_sha256.
// 2. Every example runs through the real runtime and gets its own sealed receipt; the experiment keeps
//    proof_id per example, so each score can be traced to a receipt.
// 3. outcome_sha256 covers what must repeat (pins, per-example verdicts and scores), not run ids;
//    experiment_sha256 covers the whole record.
// 4. compare(a, b) only compares experiments over the same dataset version and reports per-example changes.

export class ExperimentError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "conflict" = "invalid") {
    super(message);
    this.name = "ExperimentError";
  }
}

export interface ExampleResult {
  example_id: string;
  run_id: string;
  proof_id: string;
  verdict: RunVerdict;
  expected_verdict: RunVerdict | null;
  scores: Record<string, number>;
}

export interface Experiment {
  experiment_id: string;
  name: string;
  dataset_id: string;
  dataset_version: number;
  dataset_version_sha256: string;
  team_id: string;
  team_version: string;
  graph_sha256: string;
  evaluators: Array<{ evaluator_id: string; evaluator_sha256: string }>;
  split: string | null;
  results: ExampleResult[];
  summary: { examples: number; verified: number; mean_scores: Record<string, number> };
  outcome_sha256: string;
  created_at: string;
  experiment_sha256: string;
}

export interface ExampleChange {
  example_id: string;
  verdict: { a: RunVerdict; b: RunVerdict } | null;
  score_deltas: Record<string, number>;
}

export interface Comparison {
  a: string;
  b: string;
  dataset_id: string;
  dataset_version: number;
  same_outcome: boolean;
  changed: ExampleChange[];
  mean_score_deltas: Record<string, number>;
  verified_delta: number;
}

function entryAgent(graph: TeamGraph): string {
  const targets = new Set(graph.edges.map((e) => e.to_agent_id));
  const entry = graph.agents.find((a) => !targets.has(a.agent_id));
  if (!entry) throw new ExperimentError("team graph has no entry agent (every agent has an incoming edge)");
  return entry.agent_id;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export type RunMission = (graph: TeamGraph, mission: ReturnType<typeof missionFromExample>) => Promise<RunResult>;

export class ExperimentStore {
  private readonly experiments: Experiment[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async run(params: {
    name?: string; dataset: DatasetVersion; graph: TeamGraph; evaluators: EvaluatorStore; evaluator_ids: string[]; split?: string;
    runMission: RunMission; onRun?: (run: RunResult) => void;
  }): Promise<Experiment> {
    const { dataset, graph, evaluators } = params;
    const integrity = verifyDatasetVersion(dataset);
    if (!integrity.ok) throw new ExperimentError(`dataset version does not verify: ${integrity.errors.join("; ")}`, "conflict");
    try { validateTeamGraph(graph); } catch (e) { throw new ExperimentError(e instanceof Error ? e.message : String(e)); }
    if (!Array.isArray(params.evaluator_ids) || params.evaluator_ids.length === 0) throw new ExperimentError("evaluator_ids must list at least one evaluator");
    const definitions = params.evaluator_ids.map((id) => evaluators.get(id));
    const examples = dataset.examples.filter((e) => params.split === undefined || e.split === params.split);
    if (examples.length === 0) throw new ExperimentError(`no examples${params.split ? ` in split ${params.split}` : ""}`);
    const entry = entryAgent(graph);

    const results: ExampleResult[] = [];
    for (const example of examples) {
      const mission = missionFromExample(dataset, example.example_id, {
        organization_id: graph.organization_id, project_id: graph.project_id, team_id: graph.team_id, team_version: graph.version, entry_agent_id: entry,
      });
      const run = await params.runMission(graph, mission);
      params.onRun?.(run);
      const observations = evaluators.evaluate(run, params.evaluator_ids, { dataset, example_id: example.example_id });
      results.push({
        example_id: example.example_id, run_id: run.run_id, proof_id: run.proof.proof_id, verdict: run.verdict,
        expected_verdict: example.expected?.verdict ?? null,
        scores: Object.fromEntries(observations.map((o) => [o.evaluator_id, o.score])),
      });
    }

    const mean = (id: string) => round(results.reduce((n, r) => n + (r.scores[id] ?? 0), 0) / results.length);
    const pins = {
      dataset_id: dataset.dataset_id, dataset_version: dataset.version, dataset_version_sha256: dataset.version_sha256,
      team_id: graph.team_id, team_version: graph.version, graph_sha256: digest(graph),
      evaluators: definitions.map((d) => ({ evaluator_id: d.evaluator_id, evaluator_sha256: d.evaluator_sha256 })),
      split: params.split ?? null,
    };
    const summary = { examples: results.length, verified: results.filter((r) => r.verdict === "VERIFIED").length, mean_scores: Object.fromEntries(params.evaluator_ids.map((id) => [id, mean(id)])) };
    const outcome_sha256 = digest({ ...pins, outcome: results.map((r) => ({ example_id: r.example_id, verdict: r.verdict, scores: r.scores })) });
    const created_at = this.clock().toISOString();
    const body = { name: String(params.name ?? `${dataset.dataset_id}@v${dataset.version} × ${graph.team_id} v${graph.version}`), ...pins, results, summary, outcome_sha256, created_at };
    const experiment_sha256 = digest(body);
    const experiment: Experiment = { experiment_id: `exp_${experiment_sha256.slice(0, 20)}`, ...body, experiment_sha256 };
    this.experiments.push(structuredClone(experiment));
    return experiment;
  }

  get(id: string): Experiment {
    const found = this.experiments.find((e) => e.experiment_id === id);
    if (!found) throw new ExperimentError(`experiment not found: ${id}`, "not_found");
    return structuredClone(found);
  }

  list(): Experiment[] {
    return this.experiments.map((e) => structuredClone(e)).reverse();
  }

  compare(aId: string, bId: string): Comparison {
    const a = this.get(aId), b = this.get(bId);
    if (a.dataset_version_sha256 !== b.dataset_version_sha256) throw new ExperimentError("experiments ran on different dataset versions; compare like with like", "conflict");
    const byId = new Map(b.results.map((r) => [r.example_id, r]));
    const changed: ExampleChange[] = [];
    for (const ra of a.results) {
      const rb = byId.get(ra.example_id);
      if (!rb) continue;
      const deltas: Record<string, number> = {};
      for (const id of new Set([...Object.keys(ra.scores), ...Object.keys(rb.scores)])) {
        const d = round((rb.scores[id] ?? 0) - (ra.scores[id] ?? 0));
        if (d !== 0) deltas[id] = d;
      }
      if (ra.verdict !== rb.verdict || Object.keys(deltas).length) changed.push({ example_id: ra.example_id, verdict: ra.verdict !== rb.verdict ? { a: ra.verdict, b: rb.verdict } : null, score_deltas: deltas });
    }
    const ids = new Set([...Object.keys(a.summary.mean_scores), ...Object.keys(b.summary.mean_scores)]);
    return {
      a: a.experiment_id, b: b.experiment_id, dataset_id: a.dataset_id, dataset_version: a.dataset_version,
      same_outcome: changed.length === 0, changed,
      mean_score_deltas: Object.fromEntries([...ids].map((id) => [id, round((b.summary.mean_scores[id] ?? 0) - (a.summary.mean_scores[id] ?? 0))])),
      verified_delta: b.summary.verified - a.summary.verified,
    };
  }
}

export function verifyExperiment(experiment: Experiment): { ok: boolean; errors: string[] } {
  const { experiment_id, experiment_sha256, ...body } = experiment;
  const errors: string[] = [];
  if (digest(body) !== experiment_sha256) errors.push("experiment_sha256 does not match the record");
  if (experiment_id !== `exp_${experiment_sha256.slice(0, 20)}`) errors.push("experiment_id does not commit to experiment_sha256");
  return { ok: errors.length === 0, errors };
}
