import { AcceptanceRequirement, Mission, RunVerdict } from "../../contracts/src";
import { CanonicalizationError, digest, digestWithout } from "../../proof-core/src/canonical";

// Datasets: versioned sets of mission examples (LangSmith / Braintrust model, OSA semantics).
//
// Rules:
// 1. Every add, update or delete creates a new immutable version (LangSmith rule). Old versions stay readable.
// 2. An example is a mission template plus an optional expected verdict, split and metadata.
// 3. Core computes example_sha256 per example, examples_root over the id-sorted examples, and
//    version_sha256 over the version (binding dataset id, number, parent, root, time, message).
// 4. Tags ("prod", "baseline") point at a version and can be moved; experiments pin a version or a tag.
// 5. Invalid input is refused whole: no partial commits.

export class DatasetError extends Error {
  constructor(message: string, readonly code: "invalid" | "not_found" | "conflict" = "invalid") {
    super(message);
    this.name = "DatasetError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const VERDICTS: RunVerdict[] = ["VERIFIED", "FAILED", "INCOMPLETE"];
export const MAX_EXAMPLES = 10_000;

export interface ExampleInput {
  example_id: string;
  objective: string;
  input: unknown;
  requirements: AcceptanceRequirement[];
  expected?: { verdict?: RunVerdict };
  split?: string;
  metadata?: Record<string, unknown>;
}

export interface DatasetExample extends ExampleInput {
  example_sha256: string;
}

export interface DatasetVersion {
  dataset_id: string;
  name: string;
  description: string;
  version: number;
  parent_version: number | null;
  created_at: string;
  message: string;
  examples: DatasetExample[];
  examples_root: string;
  version_sha256: string;
}

export interface DatasetVersionSummary {
  dataset_id: string;
  version: number;
  parent_version: number | null;
  created_at: string;
  message: string;
  example_count: number;
  examples_root: string;
  version_sha256: string;
  tags: string[];
}

export interface CommitChanges {
  upsert?: ExampleInput[];
  remove?: string[];
  message?: string;
}

function validateExample(example: ExampleInput, where: string): void {
  if (!example || typeof example !== "object") throw new DatasetError(`${where}: example must be an object`);
  if (typeof example.example_id !== "string" || !ID.test(example.example_id)) {
    throw new DatasetError(`${where}: example_id must match ${ID.source}`);
  }
  if (typeof example.objective !== "string" || !example.objective.trim()) {
    throw new DatasetError(`${where}: objective is required`);
  }
  if (!Array.isArray(example.requirements) || example.requirements.length === 0) {
    throw new DatasetError(`${where}: at least one acceptance requirement is required`);
  }
  for (const requirement of example.requirements) {
    if (!requirement || requirement.type !== "evidence_field_equals" || !requirement.requirement_id || !requirement.evidence_kind || !requirement.field) {
      throw new DatasetError(`${where}: requirements must be complete evidence_field_equals requirements`);
    }
  }
  if (example.expected?.verdict !== undefined && !VERDICTS.includes(example.expected.verdict)) {
    throw new DatasetError(`${where}: expected.verdict must be one of ${VERDICTS.join(", ")}`);
  }
  if (example.split !== undefined && (typeof example.split !== "string" || !ID.test(example.split))) {
    throw new DatasetError(`${where}: split must match ${ID.source}`);
  }
}

function sealExample(example: ExampleInput, where: string): DatasetExample {
  validateExample(example, where);
  const clean: ExampleInput = {
    example_id: example.example_id,
    objective: example.objective,
    input: structuredClone(example.input),
    requirements: structuredClone(example.requirements),
    ...(example.expected ? { expected: { ...example.expected } } : {}),
    ...(example.split !== undefined ? { split: example.split } : {}),
    ...(example.metadata !== undefined ? { metadata: structuredClone(example.metadata) } : {}),
  };
  try {
    return { ...clean, example_sha256: digest(clean) };
  } catch (error) {
    if (error instanceof CanonicalizationError) throw new DatasetError(`${where}: ${error.message}`);
    throw error;
  }
}

function examplesRoot(examples: DatasetExample[]): string {
  return digest(examples.map((e) => ({ example_id: e.example_id, example_sha256: e.example_sha256 })));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function verifyDatasetVersion(version: DatasetVersion): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = version.examples.map((e) => e.example_id);
  if (ids.some((id, i) => i > 0 && ids[i - 1] >= id)) errors.push("examples are not sorted by unique example_id");
  for (const example of version.examples) {
    let recomputed: string | null = null;
    try { recomputed = digestWithout(example, "example_sha256"); } catch { recomputed = null; }
    if (recomputed !== example.example_sha256) errors.push(`example ${example.example_id} does not match example_sha256`);
  }
  if (examplesRoot(version.examples) !== version.examples_root) errors.push("examples_root does not match examples");
  let versionSha: string | null = null;
  try { versionSha = digestWithout(version, "version_sha256"); } catch { versionSha = null; }
  if (versionSha !== version.version_sha256) errors.push("version_sha256 does not match version contents");
  return { ok: errors.length === 0, errors };
}

export class DatasetStore {
  private readonly versions = new Map<string, DatasetVersion[]>();
  private readonly tags = new Map<string, Map<string, number>>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  create(params: { dataset_id: string; name: string; description?: string; examples: ExampleInput[]; message?: string }): DatasetVersion {
    if (typeof params.dataset_id !== "string" || !ID.test(params.dataset_id)) throw new DatasetError(`dataset_id must match ${ID.source}`);
    if (typeof params.name !== "string" || !params.name.trim()) throw new DatasetError("name is required");
    if (this.versions.has(params.dataset_id)) throw new DatasetError(`dataset already exists: ${params.dataset_id}`, "conflict");
    if (!Array.isArray(params.examples) || params.examples.length === 0) throw new DatasetError("a dataset starts with at least one example");
    const byId = this.assemble(new Map(), params.examples, []);
    return this.append(params.dataset_id, params.name, params.description ?? "", byId, null, params.message ?? "create");
  }

  commit(datasetId: string, changes: CommitChanges): DatasetVersion {
    const history = this.history(datasetId);
    const parent = history[history.length - 1];
    const current = new Map(parent.examples.map((e) => [e.example_id, e]));
    const next = this.assemble(current, changes.upsert ?? [], changes.remove ?? []);
    if (examplesRoot([...next.values()].sort(byExampleId)) === parent.examples_root) {
      throw new DatasetError("commit changes nothing", "conflict");
    }
    return this.append(datasetId, parent.name, parent.description, next, parent.version, changes.message ?? "update");
  }

  // `ref`: a version number, a tag, or nothing for the latest version.
  get(datasetId: string, ref?: number | string): DatasetVersion {
    const history = this.history(datasetId);
    if (ref === undefined || ref === "latest") return structuredClone(history[history.length - 1]);
    const number = typeof ref === "number" ? ref : /^\d+$/.test(ref) ? Number(ref) : this.tags.get(datasetId)?.get(ref);
    const found = history.find((v) => v.version === number);
    if (!found) throw new DatasetError(`dataset ${datasetId} has no version ${String(ref)}`, "not_found");
    return structuredClone(found);
  }

  tag(datasetId: string, tag: string, version: number): DatasetVersionSummary {
    if (!ID.test(tag) || /^\d+$/.test(tag) || tag === "latest") throw new DatasetError("tag must be a name, not a number or 'latest'");
    const target = this.get(datasetId, version);
    const tags = this.tags.get(datasetId) ?? new Map<string, number>();
    tags.set(tag, target.version);
    this.tags.set(datasetId, tags);
    return this.summary(target);
  }

  history(datasetId: string): DatasetVersion[] {
    const history = this.versions.get(datasetId);
    if (!history) throw new DatasetError(`dataset not found: ${datasetId}`, "not_found");
    return history;
  }

  listVersions(datasetId: string): DatasetVersionSummary[] {
    return this.history(datasetId).map((v) => this.summary(v));
  }

  list(): DatasetVersionSummary[] {
    return [...this.versions.values()].map((history) => this.summary(history[history.length - 1]));
  }

  private summary(v: DatasetVersion): DatasetVersionSummary {
    const tags = [...(this.tags.get(v.dataset_id) ?? new Map()).entries()].filter(([, n]) => n === v.version).map(([t]) => t).sort();
    return {
      dataset_id: v.dataset_id, version: v.version, parent_version: v.parent_version, created_at: v.created_at, message: v.message,
      example_count: v.examples.length, examples_root: v.examples_root, version_sha256: v.version_sha256, tags,
    };
  }

  private assemble(current: Map<string, DatasetExample>, upsert: ExampleInput[], remove: string[]): Map<string, DatasetExample> {
    if (!Array.isArray(upsert) || !Array.isArray(remove)) throw new DatasetError("upsert and remove must be arrays");
    const next = new Map(current);
    const touched = new Set<string>();
    upsert.forEach((example, i) => {
      const sealed = sealExample(example, `upsert[${i}]`);
      if (touched.has(sealed.example_id)) throw new DatasetError(`duplicate example_id in one commit: ${sealed.example_id}`);
      touched.add(sealed.example_id);
      next.set(sealed.example_id, sealed);
    });
    for (const id of remove) {
      if (touched.has(id)) throw new DatasetError(`example ${id} is both upserted and removed`);
      if (!next.delete(id)) throw new DatasetError(`cannot remove missing example: ${id}`, "not_found");
    }
    if (next.size > MAX_EXAMPLES) throw new DatasetError(`a dataset holds at most ${MAX_EXAMPLES} examples`);
    if (next.size === 0) throw new DatasetError("a dataset version needs at least one example");
    return next;
  }

  private append(datasetId: string, name: string, description: string, examples: Map<string, DatasetExample>, parent: number | null, message: string): DatasetVersion {
    const sorted = [...examples.values()].sort(byExampleId);
    const history = this.versions.get(datasetId) ?? [];
    const body: Omit<DatasetVersion, "version_sha256"> = {
      dataset_id: datasetId,
      name,
      description,
      version: history.length + 1,
      parent_version: parent,
      created_at: this.clock().toISOString(),
      message: String(message),
      examples: sorted.map((e) => structuredClone(e)),
      examples_root: examplesRoot(sorted),
    };
    const version = deepFreeze({ ...body, version_sha256: digest(body) }) as DatasetVersion;
    history.push(version);
    this.versions.set(datasetId, history);
    return structuredClone(version);
  }
}

function byExampleId(a: DatasetExample, b: DatasetExample): number {
  return a.example_id < b.example_id ? -1 : a.example_id > b.example_id ? 1 : 0;
}

// Turns a pinned example into a runnable mission; the mission id names the dataset version it came from.
export function missionFromExample(
  version: DatasetVersion,
  exampleId: string,
  team: { organization_id: string; project_id: string; team_id: string; team_version: string; entry_agent_id: string }
): Mission {
  const example = version.examples.find((e) => e.example_id === exampleId);
  if (!example) throw new DatasetError(`example not found in ${version.dataset_id} v${version.version}: ${exampleId}`, "not_found");
  return {
    organization_id: team.organization_id,
    project_id: team.project_id,
    mission_id: `${version.dataset_id}@v${version.version}:${example.example_id}`,
    team_id: team.team_id,
    team_version: team.team_version,
    objective: example.objective,
    entry_agent_id: team.entry_agent_id,
    input: structuredClone(example.input),
    requirements: structuredClone(example.requirements),
  };
}
