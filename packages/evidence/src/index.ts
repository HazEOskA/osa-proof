import { EvidenceInput, EvidenceRecord, ExecutionBinding, ExecutorProducer } from "../../contracts/src";
import { digestWithout, sha256Hex } from "../../proof-core/src/canonical";

// Records evidence per execution. Core, not the executor, binds the record to its
// execution and computes its digests; executor-supplied hash fields in `data` are
// claims only and never define the record identity.
export class EvidenceCollector {
  private readonly byExecution = new Map<string, EvidenceRecord[]>();

  record(params: {
    binding: ExecutionBinding;
    producer: ExecutorProducer;
    evidence: EvidenceInput;
  }): EvidenceRecord {
    const { binding, producer, evidence } = params;
    if (evidence.content !== undefined && typeof evidence.content !== "string") {
      throw new Error("evidence content must be a string");
    }

    const current = this.byExecution.get(binding.execution_id) ?? [];
    const sequence = current.length + 1;
    const unsigned: Omit<EvidenceRecord, "evidence_sha256"> = {
      evidence_id: `${binding.run_id}:${binding.execution_id}:evidence:${sequence}`,
      run_id: binding.run_id,
      execution_id: binding.execution_id,
      sequence,
      organization_id: binding.organization_id,
      project_id: binding.project_id,
      team_id: binding.team_id,
      team_version: binding.team_version,
      mission_id: binding.mission_id,
      agent_id: producer.agent_id,
      provenance: "EXECUTOR_EVIDENCE",
      binding: { ...binding },
      producer: { ...producer },
      kind: evidence.kind,
      data: structuredClone(evidence.data),
      ...(evidence.content !== undefined
        ? {
            content_sha256: sha256Hex(Buffer.from(evidence.content, "utf8")),
            content_bytes: Buffer.byteLength(evidence.content, "utf8"),
          }
        : {}),
    };
    const record = { ...unsigned, evidence_sha256: "" } as EvidenceRecord;
    record.evidence_sha256 = digestWithout(record, "evidence_sha256");

    current.push(record);
    this.byExecution.set(binding.execution_id, current);
    return structuredClone(record);
  }

  list(executionId: string): EvidenceRecord[] {
    return (this.byExecution.get(executionId) ?? []).map((record) => structuredClone(record));
  }
}
