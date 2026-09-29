import { digest } from "../../proof-core/src/canonical";

// Intelligence layer: a fixed catalog of modules whose status is computed, never declared.
//
// Rules:
// 1. The catalog below is the only list of modules. Unknown ids are rejected.
// 2. No registered implementation            -> SOON.
// 3. Implementation registered               -> PREVIEW until every required proof passes.
// 4. LIVE only when every required proof passes AND every dependency is LIVE.
// 5. A missing check, a failing check or a check that throws counts as a failed proof (fail closed).
// 6. Each status report is content-addressed (report_sha256); the UI reads it and never sets status.

export type IntelligenceModuleId =
  | "models"
  | "model-mesh"
  | "llm-gateway"
  | "memory"
  | "knowledge"
  | "context-hub"
  | "datasets"
  | "experiments"
  | "evaluators";

export type ModuleStatus = "SOON" | "PREVIEW" | "LIVE";

export interface ModuleSpec {
  id: IntelligenceModuleId;
  label: string;
  purpose: string;
  depends_on: IntelligenceModuleId[];
  // Proof ids that must all pass before the module may be LIVE.
  required_proofs: string[];
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface ReadinessCheck {
  proof_id: string;
  run(): CheckResult | Promise<CheckResult>;
}

export interface ModuleImplementation {
  id: IntelligenceModuleId;
  version: string;
  checks: ReadinessCheck[];
}

export interface ProofResult {
  proof_id: string;
  ok: boolean;
  detail: string;
}

export interface ModuleReport {
  id: IntelligenceModuleId;
  label: string;
  purpose: string;
  status: ModuleStatus;
  version: string | null;
  depends_on: IntelligenceModuleId[];
  blocked_by: IntelligenceModuleId[];
  proofs: ProofResult[];
  evaluated_at: string;
  report_sha256: string;
}

export const INTELLIGENCE_CATALOG: readonly ModuleSpec[] = [
  {
    id: "models",
    label: "Models",
    purpose: "Which models are configured and allowed, validated before any call.",
    depends_on: [],
    required_proofs: ["config.fails_closed", "models.lists_configured", "provider.rejects_unknown"],
  },
  {
    id: "llm-gateway",
    label: "LLM Gateway",
    purpose: "One call surface over model providers: config, secrets, routing and retries.",
    depends_on: ["models"],
    required_proofs: ["config.fails_closed", "errors.redact_secrets", "routing.multi_provider", "calls.bounded_retries"],
  },
  {
    id: "model-mesh",
    label: "Model Mesh",
    purpose: "Fallback and routing across several models for one step, with evidence per hop.",
    depends_on: ["llm-gateway"],
    required_proofs: ["mesh.fallback_on_failure", "mesh.evidence_per_hop"],
  },
  {
    id: "memory",
    label: "Memory",
    purpose: "Agent and session memory scoped to an execution; every write is evidence.",
    depends_on: [],
    required_proofs: ["memory.scoped_to_execution", "memory.writes_are_evidence"],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    purpose: "Retrieval over sources; every answer cites content-addressed sources.",
    depends_on: [],
    required_proofs: ["knowledge.sources_cited", "knowledge.content_digests"],
  },
  {
    id: "context-hub",
    label: "Context Hub",
    purpose: "Assembles memory and knowledge into a bounded, reproducible model context.",
    depends_on: ["memory", "knowledge"],
    required_proofs: ["context.assembly_deterministic", "context.budget_enforced"],
  },
  {
    id: "datasets",
    label: "Datasets",
    purpose: "Versioned mission sets with content digests.",
    depends_on: [],
    required_proofs: ["datasets.versioned", "datasets.content_digests"],
  },
  {
    id: "evaluators",
    label: "Evaluators",
    purpose: "Scoring of runs; results recorded as verifier observations.",
    depends_on: [],
    required_proofs: ["evaluators.deterministic_or_labeled", "evaluators.results_as_observations"],
  },
  {
    id: "experiments",
    label: "Experiments",
    purpose: "Runs a dataset against versions of a team and compares receipts.",
    depends_on: ["datasets", "evaluators"],
    required_proofs: ["experiments.reproducible", "experiments.receipts_compared"],
  },
];

const SPEC_BY_ID = new Map<string, ModuleSpec>(INTELLIGENCE_CATALOG.map((spec) => [spec.id, spec]));

export class IntelligenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntelligenceConfigError";
  }
}

export function getModuleSpec(id: string): ModuleSpec | undefined {
  return SPEC_BY_ID.get(id);
}

export class IntelligenceRegistry {
  private readonly implementations = new Map<IntelligenceModuleId, ModuleImplementation>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  register(implementation: ModuleImplementation): void {
    if (!SPEC_BY_ID.has(implementation.id)) {
      throw new IntelligenceConfigError(`unknown intelligence module: ${implementation.id}`);
    }
    if (this.implementations.has(implementation.id)) {
      throw new IntelligenceConfigError(`intelligence module already registered: ${implementation.id}`);
    }
    this.implementations.set(implementation.id, implementation);
  }

  async report(id: string): Promise<ModuleReport | undefined> {
    const reports = await this.reportAll();
    return reports.find((report) => report.id === id);
  }

  async reportAll(): Promise<ModuleReport[]> {
    const evaluatedAt = this.clock().toISOString();
    const proofsById = new Map<IntelligenceModuleId, ProofResult[]>();
    for (const spec of INTELLIGENCE_CATALOG) {
      const implementation = this.implementations.get(spec.id);
      proofsById.set(spec.id, implementation ? await runProofs(spec, implementation) : []);
    }

    const status = new Map<IntelligenceModuleId, ModuleStatus>();
    const resolve = (id: IntelligenceModuleId, seen: Set<IntelligenceModuleId>): ModuleStatus => {
      const known = status.get(id);
      if (known) return known;
      if (seen.has(id)) throw new IntelligenceConfigError(`dependency cycle at ${id}`);
      seen.add(id);
      const spec = SPEC_BY_ID.get(id)!;
      let result: ModuleStatus;
      if (!this.implementations.has(id)) {
        result = "SOON";
      } else {
        const proofsOk = proofsById.get(id)!.every((proof) => proof.ok);
        const depsLive = spec.depends_on.every((dep) => resolve(dep, seen) === "LIVE");
        result = proofsOk && depsLive ? "LIVE" : "PREVIEW";
      }
      status.set(id, result);
      return result;
    };

    return INTELLIGENCE_CATALOG.map((spec) => {
      const moduleStatus = resolve(spec.id, new Set());
      const implementation = this.implementations.get(spec.id);
      const body: Omit<ModuleReport, "report_sha256"> = {
        id: spec.id,
        label: spec.label,
        purpose: spec.purpose,
        status: moduleStatus,
        version: implementation ? implementation.version : null,
        depends_on: [...spec.depends_on],
        blocked_by: implementation ? spec.depends_on.filter((dep) => status.get(dep) !== "LIVE") : [],
        proofs: proofsById.get(spec.id)!,
        evaluated_at: evaluatedAt,
      };
      return { ...body, report_sha256: digest(body) };
    });
  }
}

async function runProofs(spec: ModuleSpec, implementation: ModuleImplementation): Promise<ProofResult[]> {
  return Promise.all(
    spec.required_proofs.map(async (proofId) => {
      const check = implementation.checks.find((candidate) => candidate.proof_id === proofId);
      if (!check) return { proof_id: proofId, ok: false, detail: "no check provided for this proof" };
      try {
        const result = await check.run();
        return { proof_id: proofId, ok: result.ok === true, detail: String(result.detail) };
      } catch (error) {
        return { proof_id: proofId, ok: false, detail: `check threw: ${error instanceof Error ? error.message : String(error)}` };
      }
    })
  );
}

export { createBuiltinIntelligence } from "./builtin";
