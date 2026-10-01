import { Web3TransactionIntent } from "../../contracts/src";
export function assessRisk(intent: Web3TransactionIntent) {
  // No pricing, contract audit or economic model is claimed in v0.1.
  return { riskLevel: intent.riskLevel, economicAssessment: "UNKNOWN", signingEnabled: false, requiresApproval: true };
}
