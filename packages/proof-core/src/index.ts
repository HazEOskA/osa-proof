import { createHash } from "node:crypto";
import {
  AcceptanceRequirement,
  EvidenceRecord,
  Mission,
  ProofReceipt,
  RequirementVerdict,
  RunVerdict,
  TeamGraph,
} from "../../contracts/src";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function readField(data: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, data);
}

function verifyRequirement(
  requirement: AcceptanceRequirement,
  evidence: EvidenceRecord[]
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

  const matching = candidates.filter(
    (record) => Object.is(readField(record.data, requirement.field), requirement.expected)
  );

  if (matching.length > 0) {
    return {
      requirement_id: requirement.requirement_id,
      verdict: "VERIFIED",
      evidence_ids: matching.map((record) => record.evidence_id),
      reason: "evidence satisfied the explicit acceptance requirement",
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

export class DeterministicProofVerifier {
  verify(params: {
    run_id: string;
    graph: TeamGraph;
    mission: Mission;
    evidence: EvidenceRecord[];
  }): ProofReceipt {
    const requirementVerdicts = params.mission.requirements.map((requirement) =>
      verifyRequirement(requirement, params.evidence)
    );
    const verdict = aggregateVerdict(requirementVerdicts);
    const proofId = `proof_${stableHash(`${params.run_id}|${verdict}|${params.graph.version}`)}`;

    return {
      proof_id: proofId,
      run_id: params.run_id,
      organization_id: params.graph.organization_id,
      project_id: params.graph.project_id,
      team_id: params.graph.team_id,
      team_version: params.graph.version,
      mission_id: params.mission.mission_id,
      verdict,
      requirement_verdicts: requirementVerdicts,
      evidence_ids: params.evidence.map((record) => record.evidence_id),
      verifier: {
        name: "osa-proof-deterministic-v1",
        version: "1",
      },
    };
  }
}
