import { Web3Approval, Web3Grant, Web3Policy, Web3PolicyResult, Web3TransactionIntent } from "../../contracts/src";
import { digest, digestWithout } from "../../proof-core/src";
import { intentDigest } from "./intent";
import { sameScope, Web3Error } from "./context";
export const READ_FIRST_POLICY: Web3Policy = {
  allowedChains: ["solana"], allowedTokens: [], allowedPrograms: [], walletAllowlist: [], walletDenylist: [],
  maxAmountByAsset: {}, humanApprovalRequired: true, simulationRequired: true, blockHighRisk: true, maxTransactionsPerMinute: 1,
};
export function evaluatePolicy(intent: Web3TransactionIntent, policy: Web3Policy, grant: Web3Grant, recentTransactions: number, now = new Date()): Web3PolicyResult {
  const reasons: string[] = []; const reject = (condition: boolean, reason: string) => { if (condition) reasons.push(reason); };
  reject(!sameScope(intent.context, grant) || !grant.agentIds.includes(intent.agentId) || !grant.permissions.includes("web3.execute"), "AGENT_PERMISSION_DENIED");
  reject(!policy.allowedChains.includes(intent.chain.id), "CHAIN_DENIED");
  reject(!policy.allowedTokens.includes(intent.asset), "TOKEN_DENIED");
  const program = intent.parameters.program;
  reject(typeof program !== "string" || !policy.allowedPrograms.includes(program), "PROGRAM_DENIED");
  reject(!policy.walletAllowlist.includes(intent.sourceEntity) || !policy.walletAllowlist.includes(intent.targetEntity), "WALLET_NOT_ALLOWLISTED");
  reject(policy.walletDenylist.includes(intent.sourceEntity) || policy.walletDenylist.includes(intent.targetEntity), "WALLET_DENYLISTED");
  const max = policy.maxAmountByAsset[intent.asset];
  reject(!/^(0|[1-9][0-9]*)$/.test(intent.amount) || !max || !/^(0|[1-9][0-9]*)$/.test(max) || BigInt(intent.amount) > BigInt(max), "AMOUNT_LIMIT_EXCEEDED_OR_UNKNOWN");
  reject(!Number.isSafeInteger(recentTransactions) || recentTransactions < 0 || !Number.isSafeInteger(policy.maxTransactionsPerMinute) || policy.maxTransactionsPerMinute < 1 || recentTransactions >= policy.maxTransactionsPerMinute, "FREQUENCY_LIMIT");
  reject(policy.simulationRequired && (!intent.simulationResult?.success || intent.simulationResult.intentDigest !== intentDigest(intent)), "SIMULATION_REQUIRED");
  reject(intent.riskLevel === "UNKNOWN" || (policy.blockHighRisk && intent.riskLevel === "HIGH"), "RISK_BLOCKED");
  reject(policy.humanApprovalRequired && !intent.requiresApproval, "APPROVAL_REQUIRED");
  reject(!["CREATED", "SIMULATED", "APPROVED"].includes(intent.status), "INTENT_STATE_DENIED");
  const body = { allowed: reasons.length === 0, reasons, intentDigest: intentDigest(intent), policyDigest: digest(policy), evaluatedAt: now.toISOString() };
  return { ...body, digest: digest(body) };
}
export function approveIntent(intent: Web3TransactionIntent, result: Web3PolicyResult, approverId: string, expiresAt: string, now = new Date()): Web3Approval {
  if (!result.allowed || !Number.isFinite(Date.parse(result.evaluatedAt)) || Date.parse(result.evaluatedAt) > now.getTime() || now.getTime() - Date.parse(result.evaluatedAt) > 300000 || result.intentDigest !== intentDigest(intent) || result.digest !== digestWithout(result, "digest") || !approverId || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime() || Date.parse(expiresAt) > now.getTime() + 300000) throw new Web3Error("WEB3_APPROVAL_DENIED", 403);
  const body = { intentId: intent.intentId, intentDigest: result.intentDigest, policyDigest: result.policyDigest, approverId, expiresAt };
  return { ...body, digest: digest(body) };
}
/** Checks linkage only; callers must retain trusted approvals server-side, not accept client receipts. */
export function verifyApproval(intent: Web3TransactionIntent, result: Web3PolicyResult, approval: Web3Approval, now = new Date()): void {
  if (!result.allowed || result.digest !== digestWithout(result, "digest") || approval.digest !== digestWithout(approval, "digest") || approval.intentId !== intent.intentId || approval.intentDigest !== intentDigest(intent) || result.intentDigest !== approval.intentDigest || result.policyDigest !== approval.policyDigest || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= now.getTime()) throw new Web3Error("WEB3_APPROVAL_INVALID", 403);
}
export function assertWriteUnavailable(): never { throw new Web3Error("WEB3_WRITE_UNSUPPORTED_V01", 409); }
