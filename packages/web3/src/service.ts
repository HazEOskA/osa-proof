import { Web3EventBus } from "./events";
import { AgentExecutionContext, ChainAdapter, ChainObservation, Mission, TeamGraph, Web3PolicyResult, Web3Capability, Web3Grant, Web3Scope, Web3WorldState } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { assertScope, object, sameScope, text, Web3Error } from "./context";
import { SolanaAdapter } from "./solana/adapter";
import { SolanaRPC } from "./solana/rpc";
import { normalizeSolanaObservation } from "./solana/normalization";
export interface ObservationBundle { input: unknown; observation: ChainObservation; world: Web3WorldState; policy: Web3PolicyResult; analysis?: unknown; risk?: unknown }
export class Web3Service {
  readonly events = new Web3EventBus();
  private readonly grants = new Map<string, { grant: Web3Grant; missionDigest: string; team: TeamGraph }>();
  private readonly executions = new Map<string, { scope: Web3Scope; bundle: ObservationBundle; outputDigest: string }>();
  constructor(readonly adapter?: ChainAdapter) {}
  describe() {
    return { version: "0.1", mode: "READ_ONLY", chain: "solana", rpcConfigured: !!this.adapter, persistence: "MISSION_STORE_EVIDENCE", projection: "REPLAY_FROM_EVIDENCE", signingEnabled: false, executionEnabled: false,
      capabilities: ["web3.read", "web3.monitor", "web3.analyze", "web3.simulate", "web3.prepareTransaction", "web3.execute", "web3.verify"].map(id => ({ id, health: this.adapter && ["web3.read", "web3.monitor", "web3.analyze", "web3.verify"].includes(id) ? "READY" : "UNAVAILABLE" })),
      agents: [{ role: "MonitoringAgent", executor_ref: "web3.monitor.v1" }, { role: "AnalysisAgent", executor_ref: "web3.analyze.v1" }, { role: "RiskAgent", executor_ref: "web3.risk.v1" }, { role: "VerificationAgent", executor_ref: "web3.verify.v1" }, { role: "TransactionAgent", executor_ref: "web3.prepareTransaction.v1", status: "UNAVAILABLE" }],
      protocols: ["Tokens", "DeFi", "NFTs", "DAOs", "Gaming"].map(id => ({ id, support: id === "Tokens" ? "SPL_READ" : "CONTRACT_ONLY" })), assurance: "RPC_VALIDATED", cryptographicProof: false };
  }
  authorize(mission: Mission, team: TeamGraph): void {
    assertScope(mission);
    const key = digest({ organization_id: mission.organization_id, project_id: mission.project_id, mission_id: mission.mission_id });
    const entry = { grant: { organization_id: mission.organization_id, project_id: mission.project_id, mission_id: mission.mission_id, agentIds: team.agents.map(a => a.agent_id), permissions: ["web3.read", "web3.monitor", "web3.analyze", "web3.verify"] as Web3Capability[] }, missionDigest: digest(mission), team: structuredClone(team) };
    const old = this.grants.get(key); if (old && digest(old) !== digest(entry)) throw new Web3Error("WEB3_GRANT_CONFLICT", 409);
    this.grants.set(key, entry);
  }
  assertPermission(context: AgentExecutionContext, permission: Web3Capability): void {
    const m = context.mission; assertScope(m);
    const entry = this.grants.get(digest({ organization_id: m.organization_id, project_id: m.project_id, mission_id: m.mission_id }));
    const agent = entry?.team.agents.find(a => a.agent_id === context.agent.agent_id);
    if (!entry || !sameScope(entry.grant, m) || entry.missionDigest !== digest(m) || !entry.grant.permissions.includes(permission) || !agent || digest(agent) !== digest(context.agent) || !context.agent.tool_capabilities?.includes(permission)) throw new Web3Error("WEB3_PERMISSION_DENIED", 403);
    if (!this.adapter) throw new Web3Error("WEB3_RPC_NOT_CONFIGURED", 503);
  }
  async observe(scope: Web3Scope, input: unknown): Promise<ObservationBundle> {
    assertScope(scope); if (!this.adapter) throw new Web3Error("WEB3_RPC_NOT_CONFIGURED", 503);
    const command = object(input); if (command.chain !== "solana") throw new Web3Error("WEB3_CHAIN_UNSUPPORTED", 422);
    const operation = text(command.operation); let observation: ChainObservation;
    const address = () => text(command.address);
    switch (operation) {
      case "wallet": observation = await this.adapter.getWallet(address()); break;
      case "balance": observation = await this.adapter.getBalance(address()); break;
      case "tokens": observation = await this.adapter.getTokenBalances(address()); break;
      case "transaction": observation = await this.adapter.getTransaction(text(command.signature)); break;
      case "status": observation = await this.adapter.getTransactionStatus(text(command.signature)); break;
      case "verify": observation = await this.adapter.verifyTransaction(text(command.signature)); break;
      case "slot": observation = await this.adapter.getSlot(); break;
      case "block": observation = await this.adapter.getBlock(Number(command.slot)); break;
      case "events": observation = await this.adapter.getEvents(address(), { limit: command.limit === undefined ? 5 : Number(command.limit), ...(command.cursor === undefined ? {} : { cursor: text(command.cursor) }) }); break;
      default: throw new Web3Error("WEB3_OPERATION_UNSUPPORTED", 422);
    }
    if (observation.chain.id !== "solana" || observation.assurance !== "RPC_VALIDATED" || observation.cryptographicProof !== false) throw new Web3Error("WEB3_OBSERVATION_INVALID");
    const normalized = normalizeSolanaObservation(observation, scope);
    const policyBody = { allowed: true, reasons: [], intentDigest: digest(input), policyDigest: digest({ mode: "READ_ONLY", allowedChains: ["solana"], operation }), evaluatedAt: observation.observedAt };
    return { input: structuredClone(input), observation, world: { ...normalized, relations: [], proofRefs: [] }, policy: { ...policyBody, digest: digest(policyBody) } };
  }
  remember(context: AgentExecutionContext, bundle: ObservationBundle): void {
    this.executions.set(context.execution_id, { scope: context.mission, bundle: structuredClone(bundle), outputDigest: digest(bundle) });
  }
  previous(context: AgentExecutionContext): ObservationBundle {
    const current = this.executions.get(context.execution_id);
    if (!current || !sameScope(current.scope, context.mission) || current.outputDigest !== digest(context.input)) throw new Web3Error("WEB3_HANDOFF_INVALID", 403);
    return structuredClone(current.bundle);
  }
  forget(executionId: string): void { this.executions.delete(executionId); }
}
export function createConfiguredWeb3(env: Record<string, string | undefined>): Web3Service {
  return new Web3Service(env.OSA_WEB3_SOLANA_RPC_URL ? new SolanaAdapter(new SolanaRPC(env.OSA_WEB3_SOLANA_RPC_URL)) : undefined);
}
