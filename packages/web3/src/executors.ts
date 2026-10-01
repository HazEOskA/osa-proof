import { AgentExecutor, Mission, TeamGraph, Web3Capability } from "../../contracts/src";
import { Capability, CapabilityCatalog } from "../../capabilities/src";
import { ExecutorRegistry } from "../../runtime/src";
import { Web3Service } from "./service";
import { web3Evidence } from "./proof";
import { assertWriteUnavailable } from "./policy";
export function installWeb3Executors(registry: ExecutorRegistry, catalog: CapabilityCatalog, service: Web3Service): void {
  const definitions: Array<{ capability: Web3Capability; executor: AgentExecutor; available: boolean }> = [
    { capability: "web3.read", available: !!service.adapter, executor: async c => { service.assertPermission(c,"web3.read"); const result = await service.observe(c.mission,c.input); service.remember(c,result); return { output: result, evidence: [web3Evidence(result.input,result.observation,result.world,result.policy)] }; } },
    { capability: "web3.monitor", available: !!service.adapter, executor: async c => { service.assertPermission(c,"web3.monitor"); const result = await service.observe(c.mission,c.input); service.remember(c,result); return { output: result, evidence: [web3Evidence(result.input,result.observation,result.world,result.policy)] }; } },
    { capability: "web3.analyze", available: !!service.adapter, executor: c => { service.assertPermission(c,"web3.analyze"); const result = service.previous(c); result.analysis = { engine: "DETERMINISTIC_READ_ANALYSIS", entities: result.world.entities.length, events: result.world.events.length, assurance: "RPC_VALIDATED", economicAssessment: "UNKNOWN" }; service.remember(c,result); return { output: result, evidence: [{ kind: "web3_decision", data: { action: "ANALYZE", analysis: result.analysis } }] }; } },
    { capability: "web3.verify", available: !!service.adapter, executor: c => { service.assertPermission(c,"web3.verify"); const result = service.previous(c); service.forget(c.execution_id); return { output: result, evidence: [{ kind: "web3_validation", data: { validated: true, assurance: "RPC_VALIDATED", cryptographicProof: false } }] }; } },
    ...(["web3.simulate", "web3.prepareTransaction", "web3.execute"] as Web3Capability[]).map(capability => ({ capability, available: false, executor: (() => assertWriteUnavailable()) as AgentExecutor })),
  ];
  for (const entry of definitions) {
    const ref = `${entry.capability}.v1`; registry.register(ref,entry.executor);
    if (!catalog.list().some(c => c.executor_ref === ref)) {
      const definition: Capability = { capability_id: entry.capability, version: "1", kind: "API", capabilities: [entry.capability], permissions: [entry.capability], inputs: { domain: "web3", chain: "solana" }, outputs: { assurance: "RPC_VALIDATED" }, cost: { unit: "rpc_request", amount: null }, risk: "UNKNOWN", health: entry.available ? "READY" : "UNAVAILABLE", executor_ref: ref };
      catalog.register(definition,entry.executor);
    }
  }
  const risk: AgentExecutor = c => { service.assertPermission(c,"web3.analyze"); const result = service.previous(c); result.risk = { action: "READ", transactionsEnabled: false, economicRisk: "UNKNOWN", policy: "READ_ONLY", allowed: true }; service.remember(c,result); return { output: result, evidence: [{ kind: "web3_risk", data: { ...result.risk as Record<string, unknown> } }] }; };
  registry.register("web3.risk.v1",risk);
  if (!catalog.list().some(c => c.executor_ref === "web3.risk.v1")) catalog.register({ capability_id: "web3.risk", version: "1", kind: "NATIVE", capabilities: ["web3.analyze"], permissions: ["web3.analyze"], inputs: {}, outputs: {}, cost: { unit: "execution", amount: 0 }, risk: "UNKNOWN", health: service.adapter ? "READY" : "UNAVAILABLE", executor_ref: "web3.risk.v1" },risk);
}
export function web3ReadTeam(organization_id: string, project_id: string): TeamGraph {
  return { organization_id, project_id, team_id: "web3_read", version: "1", agents: [
    { agent_id: "web3_monitor", role: "MonitoringAgent", executor_ref: "web3.monitor.v1", tool_capabilities: ["web3.monitor"] },
    { agent_id: "web3_analysis", role: "AnalysisAgent", executor_ref: "web3.analyze.v1", tool_capabilities: ["web3.analyze"] },
    { agent_id: "web3_risk", role: "RiskAgent", executor_ref: "web3.risk.v1", tool_capabilities: ["web3.analyze"] },
    { agent_id: "web3_verification", role: "VerificationAgent", executor_ref: "web3.verify.v1", tool_capabilities: ["web3.verify"] },
  ], edges: [
    { edge_id: "web3_monitor_analysis", from_agent_id: "web3_monitor", to_agent_id: "web3_analysis", kind: "handoff" },
    { edge_id: "web3_analysis_risk", from_agent_id: "web3_analysis", to_agent_id: "web3_risk", kind: "handoff" },
    { edge_id: "web3_risk_verification", from_agent_id: "web3_risk", to_agent_id: "web3_verification", kind: "handoff" },
  ] };
}
export function web3ReadMission(mission_id: string, team: TeamGraph, input: unknown): Mission {
  return { organization_id: team.organization_id, project_id: team.project_id, mission_id, team_id: team.team_id, team_version: team.version,
    objective: "Read and validate a Solana RPC observation without signing or submitting transactions", entry_agent_id: "web3_monitor", input,
    policy: { allowed_executor_refs: team.agents.map(a => a.executor_ref) },
    requirements: [{ requirement_id: "web3_rpc_validated", type: "evidence_field_equals", evidence_kind: "web3_observation", agent_id: "web3_monitor", field: "validated", expected: true },
      { requirement_id: "web3_validation_completed", type: "evidence_field_equals", evidence_kind: "web3_validation", agent_id: "web3_verification", field: "validated", expected: true }] };
}
