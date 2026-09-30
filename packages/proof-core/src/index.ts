import {
  AcceptanceRequirement,
  EvidenceRecord,
  ExecutionBinding,
  Mission,
  ObservationCheck,
  ProofReceipt,
  RequirementVerdict,
  RunVerdict,
  TeamGraph,
  VerifierObservation,
  VerifierProducer,
} from "../../contracts/src";
import { canonicalJson, digest, digestWithout } from "./canonical";

export * from "./canonical";
export * from "./mission-verifier";

export const RUNTIME_EXECUTION_REQUIREMENT_ID = "__runtime_execution__";

const VERIFIER: VerifierProducer = { type: "verifier", name: "osa-proof-deterministic", version: "2" };

function readField(data: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, data);
}

export function bindingFor(graph: TeamGraph, mission: Mission, runId: string, executionId: string): ExecutionBinding {
  return {
    organization_id: graph.organization_id,
    project_id: graph.project_id,
    team_id: graph.team_id,
    team_version: graph.version,
    mission_id: mission.mission_id,
    run_id: runId,
    execution_id: executionId,
  };
}

function safeDigest(value: unknown): string | null {
  try {
    return digest(value);
  } catch {
    return null;
  }
}

function canonicalOrString(value: unknown): unknown {
  return value === undefined || safeDigest(value) !== null ? value : String(value);
}

function bindingMatches(record: EvidenceRecord, expected: ExecutionBinding): boolean {
  const flat = {
    organization_id: record.organization_id,
    project_id: record.project_id,
    team_id: record.team_id,
    team_version: record.team_version,
    mission_id: record.mission_id,
    run_id: record.run_id,
    execution_id: record.execution_id,
  };
  if (safeDigest(expected) === null) return false;
  const want = canonicalJson(expected);
  return (
    safeDigest(record.binding) !== null &&
    canonicalJson(record.binding) === want &&
    canonicalJson(flat) === want &&
    record.provenance === "EXECUTOR_EVIDENCE" &&
    record.producer?.type === "executor" &&
    record.producer.agent_id === record.agent_id
  );
}

function evidenceDigestOf(record: EvidenceRecord): string | null {
  try {
    return digestWithout(record, "evidence_sha256");
  } catch {
    return null;
  }
}

function verifyRequirement(
  requirement: AcceptanceRequirement,
  evidence: EvidenceRecord[],
  rejected: Map<string, string>
): RequirementVerdict {
  const candidates = evidence.filter(
    (record) =>
      record.kind === requirement.evidence_kind &&
      (!requirement.agent_id || record.agent_id === requirement.agent_id)
  );

  if (candidates.length === 0) {
    return {
      requirement_id: requirement.requirement_id,
      verdict: "INCOMPLETE",
      evidence_ids: [],
      reason: "required evidence was not produced",
    };
  }

  const accepted = candidates.filter((record) => !rejected.has(record.evidence_id));
  const failedIntegrity = candidates.filter((record) => rejected.has(record.evidence_id));

  const matching = accepted.filter(
    (record) => Object.is(readField(record.data, requirement.field), requirement.expected)
  );

  if (failedIntegrity.length === 0 && matching.length > 0) {
    return {
      requirement_id: requirement.requirement_id,
      verdict: "VERIFIED",
      evidence_ids: matching.map((record) => record.evidence_id),
      reason: "evidence satisfied the explicit acceptance requirement",
    };
  }

  if (failedIntegrity.length > 0) {
    return {
      requirement_id: requirement.requirement_id,
      verdict: "FAILED",
      evidence_ids: failedIntegrity.map((record) => record.evidence_id),
      reason: `evidence failed integrity checks: ${failedIntegrity
        .map((record) => rejected.get(record.evidence_id))
        .join("; ")}`,
    };
  }

  return {
    requirement_id: requirement.requirement_id,
    verdict: "FAILED",
    evidence_ids: candidates.map((record) => record.evidence_id),
    reason: "evidence was produced but did not satisfy the expected value",
  };
}

function aggregateVerdict(verdicts: RequirementVerdict[]): RunVerdict {
  if (verdicts.some((item) => item.verdict === "FAILED")) return "FAILED";
  if (verdicts.some((item) => item.verdict === "INCOMPLETE")) return "INCOMPLETE";
  return "VERIFIED";
}

export function evidenceRoot(refs: ProofReceipt["evidence_refs"]): string {
  return digest(refs);
}

export function sealProofReceipt(body: Omit<ProofReceipt, "proof_id" | "receipt_sha256">): ProofReceipt {
  const receiptSha256 = digest(body);
  return { ...body, proof_id: `proof_${receiptSha256}`, receipt_sha256: receiptSha256 };
}

export interface VerifyParams {
  run_id: string;
  execution_id: string;
  graph: TeamGraph;
  mission: Mission;
  evidence: EvidenceRecord[];
  runtime_failure?: string;
  final_output: unknown;
  created_at: string;
}

export interface VerificationResult {
  proof: ProofReceipt;
  observations: VerifierObservation[];
}

export class DeterministicProofVerifier {
  verify(params: VerifyParams): VerificationResult {
    const binding = bindingFor(params.graph, params.mission, params.run_id, params.execution_id);
    const observations: VerifierObservation[] = [];
    const rejected = new Map<string, string>();

    const observe = (
      record: EvidenceRecord,
      check: ObservationCheck,
      ok: boolean,
      reason: string,
      expected?: unknown,
      observed?: unknown
    ): void => {
      const unsealed: VerifierObservation = {
        observation_id: `${binding.run_id}:${binding.execution_id}:observation:${observations.length + 1}`,
        sequence: observations.length + 1,
        provenance: "VERIFIER_OBSERVATION",
        binding: { ...binding },
        producer: { ...VERIFIER },
        evidence_id: String(record.evidence_id),
        check,
        ok,
        expected: canonicalOrString(expected),
        observed: canonicalOrString(observed),
        reason,
        observation_sha256: "",
      };
      unsealed.observation_sha256 = digestWithout(unsealed, "observation_sha256");
      observations.push(unsealed);
      if (!ok && !rejected.has(record.evidence_id)) rejected.set(record.evidence_id, `${check}: ${reason}`);
    };

    for (const record of params.evidence) {
      const bound = bindingMatches(record, binding);
      observe(record, "binding", bound, bound ? "evidence bound to this execution" : "evidence is bound to a different execution context");

      const recomputed = evidenceDigestOf(record);
      const digestOk = recomputed !== null && recomputed === record.evidence_sha256;
      observe(
        record,
        "evidence_digest",
        digestOk,
        digestOk ? "evidence digest recomputed" : "evidence was modified after hashing",
        record.evidence_sha256,
        recomputed
      );

      const claimed = record.data?.content_sha256;
      if (claimed !== undefined || record.content_sha256 !== undefined) {
        const contentOk = typeof claimed === "string"
          ? record.content_sha256 !== undefined && claimed === record.content_sha256
          : claimed === undefined && typeof record.content_sha256 === "string";
        observe(
          record,
          "content_digest",
          contentOk,
          contentOk
            ? "claimed content digest matches core-computed digest"
            : "claimed content digest does not match core-computed digest",
          claimed,
          record.content_sha256
        );
      }
    }

    const requirementVerdicts = params.mission.requirements.map((requirement) =>
      verifyRequirement(requirement, params.evidence, rejected)
    );

    const finalOutputSha256 = safeDigest(params.final_output);
    let runtimeFailure = params.runtime_failure;
    if (finalOutputSha256 === null && runtimeFailure === undefined) {
      runtimeFailure = "final output is not canonicalizable";
    }
    if (runtimeFailure !== undefined) {
      requirementVerdicts.push({
        requirement_id: RUNTIME_EXECUTION_REQUIREMENT_ID,
        verdict: "FAILED",
        evidence_ids: [],
        reason: runtimeFailure,
      });
    }

    const evidenceRefs = params.evidence.map((record) => ({
      evidence_id: String(record.evidence_id),
      evidence_sha256: String(record.evidence_sha256),
    }));

    const proof = sealProofReceipt({
      schema: "osa.proof_receipt.v2",
      run_id: binding.run_id,
      execution_id: binding.execution_id,
      organization_id: binding.organization_id,
      project_id: binding.project_id,
      team_id: binding.team_id,
      team_version: binding.team_version,
      mission_id: binding.mission_id,
      binding,
      verdict: aggregateVerdict(requirementVerdicts),
      requirement_verdicts: requirementVerdicts,
      ...(runtimeFailure !== undefined ? { runtime_failure: runtimeFailure } : {}),
      evidence_ids: evidenceRefs.map((ref) => ref.evidence_id),
      evidence_refs: evidenceRefs,
      evidence_root: evidenceRoot(evidenceRefs),
      observation_refs: observations.map((observation) => ({
        observation_id: observation.observation_id,
        observation_sha256: observation.observation_sha256,
      })),
      final_output_sha256: finalOutputSha256,
      created_at: params.created_at,
      verifier: { name: "osa-proof-deterministic", version: "2" },
    });

    return { proof, observations };
  }
}

export interface ReceiptIntegrityResult {
  ok: boolean;
  errors: string[];
}

// Recomputes every digest a receipt commits to. Detects any change to the receipt,
// its evidence, its observations or the final output made after sealing, unless all
// of them are recomputed consistently; anchoring receipt_sha256 outside the process
// (signatures, transparency log) is future work.
export function verifyProofReceipt(params: {
  receipt: ProofReceipt;
  evidence: EvidenceRecord[];
  observations: VerifierObservation[];
  final_output: unknown;
}): ReceiptIntegrityResult {
  const { receipt } = params;
  const errors: string[] = [];

  let recomputedReceipt: string | null = null;
  try {
    const { proof_id: _id, receipt_sha256: _sha, ...body } = receipt;
    recomputedReceipt = digest(body);
  } catch {
    errors.push("receipt is not canonicalizable");
  }
  if (recomputedReceipt !== receipt.receipt_sha256) errors.push("receipt_sha256 does not match receipt contents");
  if (receipt.proof_id !== `proof_${receipt.receipt_sha256}`) errors.push("proof_id does not commit to receipt_sha256");

  const recomputedRefs = params.evidence.map((record) => ({
    evidence_id: record.evidence_id,
    evidence_sha256: evidenceDigestOf(record),
  }));
  if (safeDigest(recomputedRefs) !== safeDigest(receipt.evidence_refs)) {
    errors.push("evidence does not match receipt evidence_refs");
  }
  if (safeDigest(receipt.evidence_refs) !== receipt.evidence_root) errors.push("evidence_root does not match evidence_refs");
  for (const record of params.evidence) {
    if (!bindingMatches(record, receipt.binding)) errors.push(`evidence ${record.evidence_id} is not bound to this receipt`);
  }

  const recomputedObservations = params.observations.map((observation) => {
    let sha: string | null = null;
    try {
      sha = digestWithout(observation, "observation_sha256");
    } catch {
      sha = null;
    }
    return { observation_id: observation.observation_id, observation_sha256: sha };
  });
  if (safeDigest(recomputedObservations) !== safeDigest(receipt.observation_refs)) {
    errors.push("observations do not match receipt observation_refs");
  }

  if (safeDigest(params.final_output) !== receipt.final_output_sha256) {
    errors.push("final output does not match final_output_sha256");
  }

  return { ok: errors.length === 0, errors };
}
