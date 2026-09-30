import { ExecutionBinding, RunResult } from "../../contracts/src";
import { CanonicalizationError, digest, digestWithout, verifyProofReceipt } from "../../proof-core/src";
import type { DatasetExample, DatasetVersion } from "../../datasets/src";

// Evaluators: score runs (OpenAI graders / LangSmith evaluators model, OSA proof semantics).
//
// Rules:
// 1. An evaluator is declarative data, not code, so its definition is content-addressed (evaluator_sha256).
// 2. Only deterministic evaluators or human labels exist. A model judge is a claim, not a proof, and is refused.
// 3. Every result is an observation bound to the run's sealed receipt (binding, proof_id, receipt_sha256)
//    with its own observation_sha256. The receipt itself is never changed.
// 4. Fail closed: when the receipt does not verify, every deterministic evaluator scores 0.
// 5. Scores are 0..1; `passed` is score >= pass_threshold.

export class EvaluatorError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "conflict" = "invalid") {
    super(message);
    this.name = "EvaluatorError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const STRING_OPS = ["eq", "neq", "like", "ilike"] as const;
export const DETERMINISTIC_TYPES = ["verdict_match", "receipt_valid", "string_check", "evidence_equals"] as const;
export const LABEL_TYPE = "human_label";

export type StringOperation = (typeof STRING_OPS)[number];

export type EvaluatorSpec =
  // Run verdict equals the example's expected.verdict.
  | { type: "verdict_match" }
  // The sealed receipt verifies against the run's evidence, observations and final output.
  | { type: "receipt_valid" }
  // A string at `path` in final_output compared with `reference` (OpenAI string_check operations).
  | { type: "string_check"; path: string; operation: StringOperation; reference: string }
  // Some evidence record of `evidence_kind` (optionally from `agent_id`) has data[field] === expected.
  | { type: "evidence_equals"; evidence_kind: string; agent_id?: string; field: string; expected: unknown }
  // A person scores the run; the score must be one of `choices`.
  | { type: "human_label"; choices: number[] };

export interface EvaluatorInput {
  evaluator_id: string;
  description?: string;
  spec: EvaluatorSpec;
  pass_threshold?: number;
}

export interface EvaluatorDefinition {
  evaluator_id: string;
  description: string;
  kind: "deterministic" | "labeled";
  spec: EvaluatorSpec;
  pass_threshold: number;
  evaluator_sha256: string;
}

export interface ExampleRef {
  dataset_id: string;
  version: number;
  example_id: string;
  example_sha256: string;
}

export interface EvaluationObservation {
  observation_id: string;
  provenance: "VERIFIER_OBSERVATION" | "HUMAN_LABEL";
  producer: { type: "evaluator"; evaluator_id: string; evaluator_sha256: string } | { type: "human"; labeler: string };
  binding: ExecutionBinding;
  proof_id: string;
  receipt_sha256: string;
  evaluator_id: string;
  evaluator_sha256: string;
  kind: "deterministic" | "labeled";
  score: number;
  pass_threshold: number;
  passed: boolean;
  expected?: unknown;
  observed?: unknown;
  reason: string;
  example?: ExampleRef;
  created_at: string;
  observation_sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateSpec(spec: EvaluatorSpec): void {
  if (!isRecord(spec) || typeof spec.type !== "string") throw new EvaluatorError("spec.type is required");
  switch (spec.type) {
    case "verdict_match":
    case "receipt_valid":
      return;
    case "string_check":
      if (typeof spec.path !== "string" || !spec.path) throw new EvaluatorError("string_check needs a path into final_output");
      if (!STRING_OPS.includes(spec.operation)) throw new EvaluatorError(`string_check operation must be one of ${STRING_OPS.join(", ")}`);
      if (typeof spec.reference !== "string") throw new EvaluatorError("string_check reference must be a string");
      return;
    case "evidence_equals":
      if (typeof spec.evidence_kind !== "string" || !spec.evidence_kind) throw new EvaluatorError("evidence_equals needs evidence_kind");
      if (typeof spec.field !== "string" || !spec.field) throw new EvaluatorError("evidence_equals needs field");
      if (!("expected" in spec)) throw new EvaluatorError("evidence_equals needs expected");
      return;
    case "human_label":
      if (!Array.isArray(spec.choices) || spec.choices.length < 2 || spec.choices.some((c) => typeof c !== "number" || c < 0 || c > 1)) {
        throw new EvaluatorError("human_label needs at least two choices between 0 and 1");
      }
      if (new Set(spec.choices).size !== spec.choices.length) throw new EvaluatorError("human_label choices must be unique");
      return;
    default:
      throw new EvaluatorError(
        `evaluator type '${(spec as { type: string }).type}' is not deterministic or labeled; allowed: ${[...DETERMINISTIC_TYPES, LABEL_TYPE].join(", ")}`
      );
  }
}

export function defineEvaluator(input: EvaluatorInput): EvaluatorDefinition {
  if (!isRecord(input)) throw new EvaluatorError("evaluator must be an object");
  if (typeof input.evaluator_id !== "string" || !ID.test(input.evaluator_id)) throw new EvaluatorError(`evaluator_id must match ${ID.source}`);
  validateSpec(input.spec);
  const threshold = input.pass_threshold ?? 1;
  if (typeof threshold !== "number" || !(threshold >= 0 && threshold <= 1)) throw new EvaluatorError("pass_threshold must be between 0 and 1");
  const body: Omit<EvaluatorDefinition, "evaluator_sha256"> = {
    evaluator_id: input.evaluator_id,
    description: String(input.description ?? ""),
    kind: input.spec.type === LABEL_TYPE ? "labeled" : "deterministic",
    spec: structuredClone(input.spec),
    pass_threshold: threshold,
  };
  try {
    return { ...body, evaluator_sha256: digest(body) };
  } catch (error) {
    if (error instanceof CanonicalizationError) throw new EvaluatorError(error.message);
    throw error;
  }
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (!isRecord(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function sameValue(a: unknown, b: unknown): boolean {
  try { return digest(a) === digest(b); } catch { return false; }
}

interface Outcome { score: number; reason: string; expected?: unknown; observed?: unknown }

function score(definition: EvaluatorDefinition, run: RunResult, example: DatasetExample | undefined, receiptOk: boolean, receiptErrors: string[]): Outcome {
  const spec = definition.spec;
  if (spec.type === "receipt_valid") {
    return { score: receiptOk ? 1 : 0, reason: receiptOk ? "receipt verifies" : `receipt integrity failed: ${receiptErrors.join("; ")}` };
  }
  if (!receiptOk) return { score: 0, reason: `receipt integrity failed: ${receiptErrors.join("; ")}` };
  switch (spec.type) {
    case "verdict_match": {
      const expected = example?.expected?.verdict;
      if (!expected) throw new EvaluatorError("verdict_match needs a dataset example with expected.verdict");
      const observed = run.proof.verdict;
      return { score: observed === expected ? 1 : 0, expected, observed, reason: observed === expected ? "verdict matches" : `verdict ${observed}, expected ${expected}` };
    }
    case "string_check": {
      const observed = readPath(run.final_output, spec.path);
      if (typeof observed !== "string") return { score: 0, observed: observed ?? null, expected: spec.reference, reason: `final_output.${spec.path} is not a string` };
      const r = spec.reference;
      const hit = spec.operation === "eq" ? observed === r
        : spec.operation === "neq" ? observed !== r
        : spec.operation === "like" ? observed.includes(r)
        : observed.toLowerCase().includes(r.toLowerCase());
      return { score: hit ? 1 : 0, observed, expected: r, reason: `${spec.operation} ${hit ? "holds" : "does not hold"} for final_output.${spec.path}` };
    }
    case "evidence_equals": {
      const records = run.evidence.filter((e) => e.kind === spec.evidence_kind && (!spec.agent_id || e.agent_id === spec.agent_id));
      const hit = records.find((e) => sameValue(e.data[spec.field], spec.expected));
      return {
        score: hit ? 1 : 0,
        expected: spec.expected,
        observed: records.map((e) => e.data[spec.field] ?? null),
        reason: hit ? `evidence ${hit.evidence_id} has ${spec.field} = expected` : `no ${spec.evidence_kind} evidence with ${spec.field} = expected`,
      };
    }
    default:
      throw new EvaluatorError(`${definition.evaluator_id} is a ${definition.kind} evaluator; record a label instead`);
  }
}

function seal(body: Omit<EvaluationObservation, "observation_id" | "observation_sha256">): EvaluationObservation {
  const observation_sha256 = digest(body);
  return { observation_id: `eval_${observation_sha256.slice(0, 24)}`, ...body, observation_sha256 };
}

function exampleRef(dataset: DatasetVersion | undefined, example: DatasetExample | undefined): ExampleRef | undefined {
  if (!dataset || !example) return undefined;
  return { dataset_id: dataset.dataset_id, version: dataset.version, example_id: example.example_id, example_sha256: example.example_sha256 };
}

function receiptIntegrity(run: RunResult) {
  return verifyProofReceipt({ receipt: run.proof, evidence: run.evidence, observations: run.observations, final_output: run.final_output });
}

export function verifyEvaluationObservation(observation: EvaluationObservation): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let sha: string | null = null;
  try {
    const { observation_id: _id, ...rest } = observation;
    sha = digestWithout(rest, "observation_sha256");
  } catch { sha = null; }
  if (sha !== observation.observation_sha256) errors.push("observation_sha256 does not match observation contents");
  if (observation.observation_id !== `eval_${observation.observation_sha256.slice(0, 24)}`) errors.push("observation_id does not commit to observation_sha256");
  if (observation.passed !== observation.score >= observation.pass_threshold) errors.push("passed does not follow from score and pass_threshold");
  return { ok: errors.length === 0, errors };
}

// Checks that an observation belongs to this run's receipt.
export function observationMatchesRun(observation: EvaluationObservation, run: RunResult): boolean {
  return observation.proof_id === run.proof.proof_id && observation.receipt_sha256 === run.proof.receipt_sha256 && sameValue(observation.binding, run.proof.binding);
}

export class EvaluatorStore {
  private readonly definitions = new Map<string, EvaluatorDefinition>();
  private readonly results = new Map<string, EvaluationObservation[]>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  // Definitions are immutable: the same id with identical content is idempotent, different content is a conflict.
  register(input: EvaluatorInput): EvaluatorDefinition {
    const definition = defineEvaluator(input);
    const existing = this.definitions.get(definition.evaluator_id);
    if (existing && existing.evaluator_sha256 !== definition.evaluator_sha256) {
      throw new EvaluatorError(`evaluator ${definition.evaluator_id} already exists with different content; use a new id`, "conflict");
    }
    this.definitions.set(definition.evaluator_id, definition);
    return structuredClone(definition);
  }

  get(evaluatorId: string): EvaluatorDefinition {
    const definition = this.definitions.get(evaluatorId);
    if (!definition) throw new EvaluatorError(`evaluator not found: ${evaluatorId}`, "not_found");
    return structuredClone(definition);
  }

  list(): EvaluatorDefinition[] {
    return [...this.definitions.values()].map((d) => structuredClone(d));
  }

  // Runs deterministic evaluators against one run. `dataset` + `example_id` bind the result to a pinned example.
  evaluate(run: RunResult, evaluatorIds: string[], context: { dataset?: DatasetVersion; example_id?: string } = {}): EvaluationObservation[] {
    if (!Array.isArray(evaluatorIds) || evaluatorIds.length === 0) throw new EvaluatorError("evaluator_ids must list at least one evaluator");
    const definitions = evaluatorIds.map((id) => this.get(id));
    const labeled = definitions.find((d) => d.kind === "labeled");
    if (labeled) throw new EvaluatorError(`${labeled.evaluator_id} is a labeled evaluator; record a label instead`);
    let example: DatasetExample | undefined;
    if (context.example_id !== undefined) {
      example = context.dataset?.examples.find((e) => e.example_id === context.example_id);
      if (!example) throw new EvaluatorError(`example not found: ${context.example_id}`, "not_found");
    }
    const integrity = receiptIntegrity(run);
    const createdAt = this.clock().toISOString();
    const sealed = definitions.map((definition) => {
      const outcome = score(definition, run, example, integrity.ok, integrity.errors);
      return seal({
        provenance: "VERIFIER_OBSERVATION",
        producer: { type: "evaluator", evaluator_id: definition.evaluator_id, evaluator_sha256: definition.evaluator_sha256 },
        binding: structuredClone(run.proof.binding),
        proof_id: run.proof.proof_id,
        receipt_sha256: run.proof.receipt_sha256,
        evaluator_id: definition.evaluator_id,
        evaluator_sha256: definition.evaluator_sha256,
        kind: "deterministic",
        score: outcome.score,
        pass_threshold: definition.pass_threshold,
        passed: outcome.score >= definition.pass_threshold,
        ...(outcome.expected !== undefined ? { expected: outcome.expected } : {}),
        ...(outcome.observed !== undefined ? { observed: outcome.observed } : {}),
        reason: outcome.reason,
        ...(exampleRef(context.dataset, example) ? { example: exampleRef(context.dataset, example) } : {}),
        created_at: createdAt,
      });
    });
    this.store(run.run_id, sealed);
    return structuredClone(sealed);
  }

  // Records a person's score for a labeled evaluator. Refused when the receipt does not verify.
  label(run: RunResult, params: { evaluator_id: string; labeler: string; score: number; comment?: string }): EvaluationObservation {
    const definition = this.get(params.evaluator_id);
    if (definition.spec.type !== "human_label") throw new EvaluatorError(`${definition.evaluator_id} is deterministic; labels are not accepted`);
    if (typeof params.labeler !== "string" || !ID.test(params.labeler)) throw new EvaluatorError(`labeler must match ${ID.source}`);
    if (!definition.spec.choices.includes(params.score)) throw new EvaluatorError(`score must be one of ${definition.spec.choices.join(", ")}`);
    const integrity = receiptIntegrity(run);
    if (!integrity.ok) throw new EvaluatorError(`cannot label a run whose receipt does not verify: ${integrity.errors.join("; ")}`, "conflict");
    const observation = seal({
      provenance: "HUMAN_LABEL",
      producer: { type: "human", labeler: params.labeler },
      binding: structuredClone(run.proof.binding),
      proof_id: run.proof.proof_id,
      receipt_sha256: run.proof.receipt_sha256,
      evaluator_id: definition.evaluator_id,
      evaluator_sha256: definition.evaluator_sha256,
      kind: "labeled",
      score: params.score,
      pass_threshold: definition.pass_threshold,
      passed: params.score >= definition.pass_threshold,
      reason: String(params.comment ?? "labeled"),
      created_at: this.clock().toISOString(),
    });
    this.store(run.run_id, [observation]);
    return structuredClone(observation);
  }

  resultsFor(runId: string): EvaluationObservation[] {
    return structuredClone(this.results.get(runId) ?? []);
  }

  private store(runId: string, observations: EvaluationObservation[]): void {
    this.results.set(runId, [...(this.results.get(runId) ?? []), ...observations]);
  }
}
