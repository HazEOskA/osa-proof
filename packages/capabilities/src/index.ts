import { AgentExecutor, AgentExecutionContext, AgentExecutionResult } from "../../contracts/src";
import { digest } from "../../proof-core/src";
export type IntegrationKind = "NATIVE" | "MCP" | "SKILL" | "PLUGIN" | "API" | "GIT" | "DATABASE" | "COMMUNICATION" | "CLOUD";
export interface Capability {
  capability_id: string; version: string; kind: IntegrationKind; capabilities: string[];
  permissions: string[]; inputs: Record<string, unknown>; outputs: Record<string, unknown>;
  cost: { unit: string; amount: number | null }; risk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  health: "READY" | "UNAVAILABLE" | "UNKNOWN"; executor_ref: string;
}
export interface CapabilityGrant { organization_id: string; project_id: string; mission_id: string; permissions: string[]; allowed_capabilities: string[] }
export class CapabilityCatalog {
  private entries = new Map<string, { definition: Capability; execute: AgentExecutor; sha256: string }>();
  register(definition: Capability, execute: AgentExecutor): void {
    if (!definition.capability_id || !definition.version || !definition.executor_ref || !["NATIVE","MCP","SKILL","PLUGIN","API","GIT","DATABASE","COMMUNICATION","CLOUD"].includes(definition.kind) || !["LOW","MEDIUM","HIGH","UNKNOWN"].includes(definition.risk) || !["READY","UNAVAILABLE","UNKNOWN"].includes(definition.health) || !definition.cost.unit || (definition.cost.amount !== null && (!Number.isFinite(definition.cost.amount) || definition.cost.amount < 0)) || ![definition.permissions,definition.capabilities].every(a => Array.isArray(a) && a.every(v => typeof v === "string" && !!v)) || !definition.inputs || !definition.outputs) throw new Error("CAPABILITY_INVALID");
    const key = `${definition.capability_id}@${definition.version}`;
    if (this.entries.has(key)) throw new Error("CAPABILITY_VERSION_ALREADY_REGISTERED");
    this.entries.set(key, { definition: structuredClone(definition), execute, sha256: digest(definition) });
  }
  registerBatch(entries: Array<{definition:Capability;execute:AgentExecutor}>): void {
    const staged=new CapabilityCatalog(); staged.entries=new Map(this.entries);
    for (const e of entries) staged.register(e.definition,e.execute);
    this.entries=staged.entries;
  }
  list(): Array<Capability & { sha256: string }> { return [...this.entries.values()].map(e => ({ ...structuredClone(e.definition), sha256: e.sha256 })); }
  executor(id: string, version: string, grant: CapabilityGrant): AgentExecutor {
    const pinnedGrant = structuredClone(grant);
    const key = `${id}@${version}`; const e = this.entries.get(key);
    if (!e) throw new Error("CAPABILITY_NOT_REGISTERED");
    return async (context: AgentExecutionContext): Promise<AgentExecutionResult> => {
      const m = context.mission;
      if (m.organization_id !== pinnedGrant.organization_id || m.project_id !== pinnedGrant.project_id || m.mission_id !== pinnedGrant.mission_id || !pinnedGrant.allowed_capabilities.includes(key) || e.definition.permissions.some(p => !pinnedGrant.permissions.includes(p))) throw new Error("CAPABILITY_PERMISSION_DENIED");
      if (e.definition.health !== "READY") throw new Error("CAPABILITY_NOT_READY");
      const result = await e.execute(context);
      const body = { schema: "osa.tool_receipt.v1", organization_id: m.organization_id, project_id: m.project_id, mission_id: m.mission_id, execution_id: context.execution_id, capability: key, capability_sha256: e.sha256, input_sha256: digest(context.input), output_sha256: digest(result.output) };
      return { ...result, evidence: [...result.evidence, { kind: "tool_receipt", data: { ...body, receipt_sha256: digest(body) } }] };
    };
  }
}
/** Existing adapters remain AgentExecutors; kind is metadata, not proof that MCP or a plugin runtime exists. */
export function nativeCapability(ref: string): Capability {
  return { capability_id: ref, version: "1", kind: "NATIVE", capabilities: [ref], permissions: ["executor.invoke"], inputs: {}, outputs: {}, cost: { unit: "execution", amount: null }, risk: "UNKNOWN", health: "READY", executor_ref: ref };
}
