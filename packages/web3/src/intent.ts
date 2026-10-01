import { Web3TransactionIntent, Web3Scope } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { assertScope, chain, object, safeMetadata, text, timestamp, Web3Error } from "./context";
export function intentDigest(intent: Web3TransactionIntent): string {
  const { simulationResult, policyResult, status, ...body } = intent; return digest(body);
}
export function createIntent(input: unknown, scope: Web3Scope): Web3TransactionIntent {
  assertScope(scope); const i = object(input);
  const amount = text(i.amount, 80);
  if (!/^(0|[1-9][0-9]*)$/.test(amount)) throw new Web3Error("WEB3_AMOUNT_MUST_BE_BASE_UNITS");
  if (!["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(String(i.riskLevel))) throw new Web3Error("WEB3_RISK_INVALID");
  return { intentId: text(i.intentId), agentId: text(i.agentId), chain: chain(i.chain), action: text(i.action),
    sourceEntity: text(i.sourceEntity), targetEntity: text(i.targetEntity), asset: text(i.asset), amount,
    parameters: safeMetadata(i.parameters ?? {}), reason: text(i.reason, 2000), riskLevel: i.riskLevel as Web3TransactionIntent["riskLevel"],
    requiresApproval: true, simulationResult: null, policyResult: null, status: "CREATED", createdAt: timestamp(i.createdAt), context: structuredClone(scope) };
}
export function cancelIntent(intent: Web3TransactionIntent): Web3TransactionIntent {
  if (!["CREATED", "SIMULATED", "APPROVED", "REJECTED"].includes(intent.status)) throw new Web3Error("WEB3_INTENT_TRANSITION_DENIED");
  return { ...structuredClone(intent), status: "CANCELLED" };
}
