import { CloudProvider, CloudGrant, DeploymentPlan, DeploymentReceipt, CloudStatus, assertGrant, verifyDeploymentPlan, readBoundedResponse } from "./index";
import { digest } from "../../proof-core/src";
/** ARM implementation is outside core. Credentials supplied by host; never copied to receipts. */
export class AzureContainerAppsProvider implements CloudProvider {
  readonly id = "azure.container-apps";
  constructor(private readonly config: { subscription_id: string; resource_group: string; environment_id: string; location: string; token: () => Promise<string>; fetchImpl?: typeof fetch }) {
    if (!/^[a-f0-9-]{36}$/i.test(config.subscription_id) || !/^[A-Za-z0-9_-]{1,64}$/.test(config.resource_group) || !/^[a-z0-9]+$/.test(config.location) || !config.environment_id.startsWith(`/subscriptions/${config.subscription_id}/resourceGroups/${config.resource_group}/providers/Microsoft.App/managedEnvironments/`) || !/^[A-Za-z0-9_/.\-]+$/.test(config.environment_id)) throw new Error("AZURE_CONFIG_INVALID");
  }
  async validate(plan: DeploymentPlan): Promise<void> { this.path(plan); }
  async provision(plan: DeploymentPlan, grant: CloudGrant): Promise<void> {
    assertGrant(plan,grant,"provision");
    // Existing managed environment must be provisioned by the reviewed worker/IaC deployment.
    await this.request("GET",this.config.environment_id,"2024-03-01");
  }
  async deploy(plan: DeploymentPlan, grant: CloudGrant): Promise<DeploymentReceipt> {
    assertGrant(plan,grant,"deploy");
    try { await this.assertOwned(plan); } catch (error) { if (!(error instanceof Error) || error.message !== "AZURE_HTTP_404") throw error; }
    await this.request("PUT",this.path(plan),"2024-03-01", { location: this.config.location, tags: { "osa.mission_id": plan.mission_id, "osa.organization_id": plan.organization_id, "osa.project_id": plan.project_id, "osa.plan_sha256": plan.plan_sha256 }, properties: { managedEnvironmentId: this.config.environment_id, configuration: { activeRevisionsMode: "Single", ingress: { external: true, targetPort: 3000, transport: "auto", allowInsecure: false } }, template: { containers: [{ name: "app", image: plan.image, resources: { cpu: 0.5, memory: "1Gi" } }], scale: { minReplicas: 0, maxReplicas: 1 } } } });
    // Submission receipt is not success; status + live validation are separate gates.
    const body: Omit<DeploymentReceipt,"receipt_sha256"> = { schema: "osa.deployment_receipt.v1", organization_id: plan.organization_id, project_id: plan.project_id, mission_id: plan.mission_id, plan_sha256: plan.plan_sha256, provider: this.id, target: plan.target, image: plan.image, created_at: new Date().toISOString() };
    return { ...body, receipt_sha256: digest(body) };
  }
  async status(plan: DeploymentPlan): Promise<CloudStatus> {
    const data = await this.request("GET",this.path(plan),"2024-03-01") as any;
    const p = data.properties ?? {}; const tags = data.tags ?? {};
    const bound = tags["osa.mission_id"] === plan.mission_id && tags["osa.organization_id"] === plan.organization_id && tags["osa.project_id"] === plan.project_id && tags["osa.plan_sha256"] === plan.plan_sha256;
    const ready = bound && p.provisioningState === "Succeeded" && !!p.latestReadyRevisionName && p.latestReadyRevisionName === p.latestRevisionName && p.runningStatus === "Running";
    const fqdn = p.configuration?.ingress?.fqdn;
    return { target: plan.target, state: ready ? "READY" : p.provisioningState === "Failed" ? "FAILED" : "PENDING", url: typeof fqdn === "string" && /^[a-z0-9.-]+\.azurecontainerapps\.io$/.test(fqdn) ? `https://${fqdn}` : null, image: p.template?.containers?.[0]?.image ?? null, evidence_sha256: digest(data) };
  }
  async logs(plan: DeploymentPlan): Promise<unknown> { return this.request("POST",`${this.path(plan)}/getLogStream`,"2024-03-01"); }
  async scale(plan: DeploymentPlan, replicas: number, grant: CloudGrant): Promise<void> {
    assertGrant(plan,grant,"scale"); if (!Number.isInteger(replicas) || replicas < 0 || replicas > 4) throw new Error("CLOUD_SCALE_LIMIT");
    await this.assertOwned(plan);
    await this.request("PATCH",this.path(plan),"2024-03-01",{ properties: { template: { scale: { minReplicas: replicas, maxReplicas: Math.max(1,replicas) } } } });
  }
  async secrets(plan: DeploymentPlan, values: Record<string,string>, grant: CloudGrant): Promise<void> {
    assertGrant(plan,grant,"secrets"); if (Object.entries(values).some(([k,v]) => !/^[a-z][a-z0-9-]{0,62}$/.test(k) || typeof v !== "string" || v.length > 8192)) throw new Error("SECRET_SCOPE_INVALID");
    await this.assertOwned(plan);
    await this.request("PATCH",this.path(plan),"2024-03-01",{ properties: { configuration: { secrets: Object.entries(values).map(([name,value]) => ({name,value})) } } });
  }
  async metrics(plan: DeploymentPlan): Promise<unknown> { return this.request("GET",`${this.path(plan)}/providers/microsoft.insights/metrics`,"2023-10-01"); }
  async destroy(plan: DeploymentPlan, grant: CloudGrant): Promise<void> { assertGrant(plan,grant,"destroy"); await this.assertOwned(plan); await this.request("DELETE",this.path(plan),"2024-03-01"); }
  async estimateCost(plan: DeploymentPlan): Promise<{ amount: null; currency: string; basis: string }> { this.path(plan); return { amount: null, currency: "USD", basis: "UNKNOWN: regional usage, registry and egress pricing required" }; }
  private async assertOwned(plan: DeploymentPlan): Promise<void> {
    const resource = await this.request("GET",this.path(plan),"2024-03-01") as any;
    if (resource.tags?.["osa.mission_id"] !== plan.mission_id || resource.tags?.["osa.organization_id"] !== plan.organization_id || resource.tags?.["osa.project_id"] !== plan.project_id) throw new Error("CLOUD_RESOURCE_SCOPE_DENIED");
  }
  private path(plan: DeploymentPlan): string {
    verifyDeploymentPlan(plan);
    if (plan.provider !== this.id || !/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(plan.target)) throw new Error("AZURE_TARGET_INVALID");
    return `/subscriptions/${this.config.subscription_id}/resourceGroups/${this.config.resource_group}/providers/Microsoft.App/containerApps/${plan.target}`;
  }
  private async request(method: string, path: string, apiVersion: string, body?: unknown): Promise<unknown> {
    const token = await this.config.token();
    const response = await (this.config.fetchImpl ?? fetch)(`https://management.azure.com${path}?api-version=${apiVersion}`,{ method, redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await readBoundedResponse(response,2*1024*1024);
    if (!response.ok) throw new Error(`AZURE_HTTP_${response.status}`);
    return text ? JSON.parse(text) : {};
  }
}
