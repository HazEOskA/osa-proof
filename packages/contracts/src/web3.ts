/** Web3 is an OSA domain. Chain names are extensible; network identifies the genesis/cluster. */
export const WEB3_ENTITY_TYPES = ["Wallet", "User", "Agent", "Chain", "Token", "NFT", "Contract", "Protocol", "DAO", "Pool", "Transaction", "Proposal", "Treasury", "GameAsset"] as const;
export type Web3EntityType = typeof WEB3_ENTITY_TYPES[number];
export interface Web3Chain { id: string; network: string }
export interface Web3Scope { organization_id: string; project_id: string; mission_id: string }
export interface Web3Entity {
  id: string; type: Web3EntityType; chain: Web3Chain; identifier: string; address?: string;
  metadata: Record<string, unknown>; ownership: string[]; context: Web3Scope; tags: string[];
  createdAt: string; updatedAt: string; proofRefs: string[];
}
export type WalletEntity = Web3Entity & { type: "Wallet" };
export type UserEntity = Web3Entity & { type: "User" };
export type AgentEntity = Web3Entity & { type: "Agent" };
export type ChainEntity = Web3Entity & { type: "Chain" };
export type TokenEntity = Web3Entity & { type: "Token" };
export type NFTEntity = Web3Entity & { type: "NFT" };
export type ContractEntity = Web3Entity & { type: "Contract" };
export type ProtocolEntity = Web3Entity & { type: "Protocol" };
export type DAOEntity = Web3Entity & { type: "DAO" };
export type PoolEntity = Web3Entity & { type: "Pool" };
export type TransactionEntity = Web3Entity & { type: "Transaction" };
export type ProposalEntity = Web3Entity & { type: "Proposal" };
export type TreasuryEntity = Web3Entity & { type: "Treasury" };
export type GameAssetEntity = Web3Entity & { type: "GameAsset" };
export const WEB3_EVENT_TYPES = ["WALLET_CONNECTED", "WALLET_DISCONNECTED", "TOKEN_TRANSFERRED", "TOKEN_RECEIVED", "NFT_MINTED", "NFT_TRANSFERRED", "CONTRACT_DEPLOYED", "PROGRAM_INVOKED", "TRANSACTION_CREATED", "TRANSACTION_SIMULATED", "TRANSACTION_SIGNED", "TRANSACTION_CONFIRMED", "TRANSACTION_FAILED", "SWAP_EXECUTED", "LIQUIDITY_CHANGED", "PRICE_THRESHOLD_REACHED", "DAO_PROPOSAL_CREATED", "DAO_VOTE_CAST", "TREASURY_MOVEMENT", "WHALE_ACTIVITY", "SECURITY_ALERT", "AGENT_ACTION_REQUESTED", "AGENT_ACTION_COMPLETED"] as const;
export type Web3EventType = typeof WEB3_EVENT_TYPES[number];
export interface Web3Event {
  eventId: string; eventType: Web3EventType; chain: Web3Chain; entityRefs: string[];
  transactionRef: string | null; slot: number | null; block: number | null; timestamp: string;
  payload: Record<string, unknown>; source: string; confidence: "RPC_VALIDATED" | "LOCAL_OBSERVATION";
  proofRef: string | null; context: Web3Scope;
}
export interface ChainObservation<T = unknown> {
  chain: Web3Chain; method: string; value: T; slot: number | null; observedAt: string;
  assurance: "RPC_VALIDATED"; cryptographicProof: false;
}
export interface WatchOptions { limit: number; cursor?: string; signal?: AbortSignal }
export interface ChainAdapter {
  connect(): Promise<Web3Chain>;
  getNetwork(): Promise<Web3Chain>;
  getWallet(address: string): Promise<ChainObservation>;
  getBalance(address: string): Promise<ChainObservation>;
  getTokenBalances(address: string): Promise<ChainObservation>;
  getTransaction(signature: string): Promise<ChainObservation>;
  getTransactionStatus(signature: string): Promise<ChainObservation>;
  getBlock(slot: number): Promise<ChainObservation>;
  getSlot(): Promise<ChainObservation>;
  getEvents(address: string, options: WatchOptions): Promise<ChainObservation>;
  simulateTransaction(intent: Web3TransactionIntent): Promise<Web3SimulationResult>;
  buildTransaction(intent: Web3TransactionIntent): Promise<Web3PreparedTransaction>;
  submitTransaction(intent: Web3TransactionIntent, authorization: Web3ExecutionAuthorization): Promise<Web3ChainReceipt>;
  verifyTransaction(signature: string): Promise<ChainObservation>;
  watchAddress(address: string, options: WatchOptions): AsyncIterable<ChainObservation>;
  watchProgram(address: string, options: WatchOptions): AsyncIterable<ChainObservation>;
}
export type Web3IntentStatus = "CREATED" | "SIMULATED" | "APPROVED" | "REJECTED" | "EXECUTING" | "CONFIRMED" | "FAILED" | "CANCELLED";
export interface Web3TransactionIntent {
  intentId: string; agentId: string; chain: Web3Chain; action: string; sourceEntity: string;
  targetEntity: string; asset: string; amount: string; parameters: Record<string, unknown>;
  reason: string; riskLevel: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; requiresApproval: boolean;
  simulationResult: { success: boolean; intentDigest: string } | null;
  policyResult: Web3PolicyResult | null; status: Web3IntentStatus; createdAt: string; context: Web3Scope;
}
export interface Web3Policy {
  allowedChains: string[]; allowedTokens: string[]; allowedPrograms: string[];
  walletAllowlist: string[]; walletDenylist: string[]; maxAmountByAsset: Record<string, string>;
  humanApprovalRequired: boolean; simulationRequired: boolean; blockHighRisk: boolean;
  maxTransactionsPerMinute: number;
}
export interface Web3PolicyResult { allowed: boolean; reasons: string[]; intentDigest: string; policyDigest: string; evaluatedAt: string; digest: string }
export interface Web3Approval { intentId: string; intentDigest: string; policyDigest: string; approverId: string; expiresAt: string; digest: string }
export type Web3Capability = "web3.read" | "web3.monitor" | "web3.analyze" | "web3.simulate" | "web3.prepareTransaction" | "web3.execute" | "web3.verify";
export interface Web3Grant extends Web3Scope { agentIds: string[]; permissions: Web3Capability[] }
export interface Web3WorldState { entities: Web3Entity[]; events: Web3Event[]; relations: Array<{ from: string; to: string; type: string }>; proofRefs: string[] }

/** Write contracts are chain-neutral extension points; v0.1 implementations reject them. */
export interface Web3SimulationResult { chain: Web3Chain; intentDigest: string; success: boolean; observedAt: string; details: Record<string, unknown> }
export interface Web3PreparedTransaction { chain: Web3Chain; intentDigest: string; unsignedPayload: string; encoding: string }
export interface Web3ExecutionAuthorization { policyResult: Web3PolicyResult; approval: Web3Approval }
export interface Web3ChainReceipt { chain: Web3Chain; transactionRef: string; status: "CONFIRMED" | "FAILED"; slot: number | null; timestamp: string; assurance: string }
