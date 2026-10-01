import { ChainObservation, EvidenceInput, EvidenceRecord, Web3PolicyResult, Web3Scope, Web3WorldState } from "../../contracts/src";
import { digest, digestWithout } from "../../proof-core/src";
import { sameScope, Web3Error } from "./context";
export function web3Evidence(input: unknown, observation: ChainObservation, world: Web3WorldState, policy: Web3PolicyResult | null = null): EvidenceInput {
  const body = { schema: "osa.web3_observation.v1", input, decision: { action: "READ", signingEnabled: false },
    policyResult: policy, simulationResult: { status: "NOT_EXECUTED" }, executionResult: { status: "READ_COMPLETED" },
    chainReceipt: observation, finalState: world, assurance: "RPC_VALIDATED", cryptographicProof: false, validated: true };
  return { kind: "web3_observation", data: { ...body, digest: digest(body) } };
}
export function validateWeb3Evidence(evidence: EvidenceRecord, scope: Web3Scope): void {
  if (evidence.kind !== "web3_observation" || !sameScope(evidence, scope) || evidence.evidence_sha256 !== digestWithout(evidence, "evidence_sha256") || evidence.data.schema !== "osa.web3_observation.v1" || evidence.data.digest !== digestWithout(evidence.data, "digest") || evidence.data.assurance !== "RPC_VALIDATED" || evidence.data.cryptographicProof !== false || evidence.data.validated !== true) throw new Web3Error("WEB3_EVIDENCE_INVALID");
}
