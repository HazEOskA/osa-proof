import type { ImageReceipt } from "./image";
import { isIP } from "node:net";
import { digest } from "../../proof-core/src";
import { WorkspaceHandle } from "../../workspace-runtime/src";
export interface MissionScope { organization_id: string; project_id: string; mission_id: string }
export interface BuildReceipt extends MissionScope {
  schema: "osa.build_receipt.v1"; source_sha256: string; artifact_sha256: string;
  checks: Array<{ name: "BUILD" | "TEST"; command_sha256: string; exit_code: number; output_sha256: string }>;
  created_at: string; receipt_sha256: string;
}
export interface DeploymentPlan extends MissionScope {
  schema: "osa.application_deployment_plan.v1"; provider: string; target: string;
  image: string; image_receipt: ImageReceipt; build: BuildReceipt; health_path: string; expected_body_sha256: string;
  created_at: string; plan_sha256: string;
}
export interface CloudStatus { target: string; state: "READY" | "PENDING" | "FAILED" | "UNKNOWN"; url: string | null; image: string | null; evidence_sha256: string }
export interface DeploymentReceipt extends MissionScope {
  schema: "osa.deployment_receipt.v1"; plan_sha256: string; provider: string; target: string;
  image: string; created_at: string; receipt_sha256: string;
}
export interface LiveVerificationReceipt extends MissionScope {
  schema: "osa.live_verification_receipt.v1"; deployment_receipt_sha256: string; plan_sha256: string;
  url: string; http_status: number; body_sha256: string; resource_evidence_sha256: string;
  verified_at: string; receipt_sha256: string;
}
export interface CloudGrant extends MissionScope { target: string; permissions: Array<"provision" | "deploy" | "scale" | "secrets" | "destroy">; plan_sha256: string }
export interface CloudProvider {
  readonly id: string;
  validate(plan: DeploymentPlan): Promise<void>;
  provision(plan: DeploymentPlan, grant: CloudGrant): Promise<void>;
  deploy(plan: DeploymentPlan, grant: CloudGrant): Promise<DeploymentReceipt>;
  status(plan: DeploymentPlan): Promise<CloudStatus>;
  logs(plan: DeploymentPlan): Promise<unknown>;
  scale(plan: DeploymentPlan, replicas: number, grant: CloudGrant): Promise<void>;
  secrets(plan: DeploymentPlan, values: Record<string,string>, grant: CloudGrant): Promise<void>;
  metrics(plan: DeploymentPlan): Promise<unknown>;
  destroy(plan: DeploymentPlan, grant: CloudGrant): Promise<void>;
  estimateCost(plan: DeploymentPlan): Promise<{ amount: number | null; currency: string; basis: string }>;
}
export function assertGrant(plan: DeploymentPlan, grant: CloudGrant, action: CloudGrant["permissions"][number]): void {
  verifyDeploymentPlan(plan);
  if (grant.organization_id !== plan.organization_id || grant.project_id !== plan.project_id || grant.mission_id !== plan.mission_id || grant.target !== plan.target || grant.plan_sha256 !== plan.plan_sha256 || !grant.permissions.includes(action)) throw new Error("CLOUD_PERMISSION_DENIED");
}
export function verifyBuildReceipt(build: BuildReceipt): void {
  const { receipt_sha256, ...body } = build;
  if (digest(body) !== receipt_sha256 || build.schema !== "osa.build_receipt.v1" || !build.organization_id || !build.project_id || !build.mission_id || !/^[a-f0-9]{64}$/.test(build.source_sha256) || !/^[a-f0-9]{64}$/.test(build.artifact_sha256) || !Number.isFinite(Date.parse(build.created_at)) || build.checks.length !== 2 || new Set(build.checks.map(c => c.name)).size !== 2 || !build.checks.every(c => ["BUILD","TEST"].includes(c.name) && c.exit_code === 0 && /^[a-f0-9]{64}$/.test(c.command_sha256) && /^[a-f0-9]{64}$/.test(c.output_sha256))) throw new Error("BUILD_RECEIPT_INVALID");
}
export async function buildAndTest(params: MissionScope & { workspace: WorkspaceHandle; source_sha256: string; build: { command: string; args: string[] }; test: { command: string; args: string[] }; artifactPath: string }): Promise<{ receipt: BuildReceipt; artifact: string }> {
  if (!/^[a-f0-9]{64}$/.test(params.source_sha256) || !/^\/workspace\/[A-Za-z0-9_./-]+$/.test(params.artifactPath) || params.artifactPath.split("/").includes("..")) throw new Error("BUILD_INPUT_INVALID");
  const checks: BuildReceipt["checks"] = [];
  for (const [name, spec] of [["BUILD",params.build],["TEST",params.test]] as const) {
    const result = await params.workspace.exec(spec.command,spec.args,{ cwd: "/workspace/project", timeoutMs: 120000 });
    if (result.exitCode !== 0) throw new Error(`${name}_FAILED`);
    checks.push({ name, command_sha256: digest(spec), exit_code: result.exitCode, output_sha256: digest({ stdout: result.stdout, stderr: result.stderr }) });
  }
  // Export only after both gates; the immutable artifact bytes can move between sandboxes.
  const exported = await params.workspace.exec("node",["-e","const fs=require('fs');const p=process.argv[1];const s=fs.statSync(p);if(!s.isFile()||s.size>1024*1024)process.exit(3);process.stdout.write(fs.readFileSync(p).toString('base64'));",params.artifactPath],{ timeoutMs: 30000 });
  if (exported.exitCode !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(exported.stdout)) throw new Error("ARTIFACT_EXPORT_FAILED");
  const artifact = exported.stdout;
  const body: Omit<BuildReceipt,"receipt_sha256"> = { schema: "osa.build_receipt.v1", organization_id: params.organization_id, project_id: params.project_id, mission_id: params.mission_id, source_sha256: params.source_sha256, artifact_sha256: digest(artifact), checks, created_at: new Date().toISOString() };
  const receipt = { ...body, receipt_sha256: digest(body) }; verifyBuildReceipt(receipt); return { receipt, artifact };
}
export function prepareDeployment(params: Omit<DeploymentPlan,"schema" | "created_at" | "plan_sha256">): DeploymentPlan {
  const body = { ...structuredClone(params), schema: "osa.application_deployment_plan.v1" as const, created_at: new Date().toISOString() };
  const plan = { ...body, plan_sha256: digest(body) }; verifyDeploymentPlan(plan); return plan;
}
export function verifyDeploymentPlan(plan: DeploymentPlan): void {
  verifyBuildReceipt(plan.build);
  const { receipt_sha256: imageSha, ...imageBody } = plan.image_receipt;
  if (digest(imageBody) !== imageSha || plan.image_receipt.schema !== "osa.image_receipt.v1" || plan.image_receipt.build_receipt_sha256 !== plan.build.receipt_sha256 || plan.image_receipt.image !== plan.image || plan.image_receipt.mission_id !== plan.mission_id || plan.image_receipt.organization_id !== plan.organization_id || plan.image_receipt.project_id !== plan.project_id) throw new Error("IMAGE_RECEIPT_INVALID");
  const { plan_sha256, ...body } = plan;
  if (digest(body) !== plan_sha256 || plan.schema !== "osa.application_deployment_plan.v1" || !plan.provider || !plan.target || !plan.organization_id || !plan.project_id || !plan.mission_id || plan.mission_id !== plan.build.mission_id || plan.organization_id !== plan.build.organization_id || plan.project_id !== plan.build.project_id || !/^[a-z0-9][a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(plan.image) || !/^\/[A-Za-z0-9/_-]*$/.test(plan.health_path) || !/^[a-f0-9]{64}$/.test(plan.expected_body_sha256) || !Number.isFinite(Date.parse(plan.created_at))) throw new Error("DEPLOYMENT_PLAN_INVALID");
}
export class CloudRegistry {
  private providers = new Map<string, CloudProvider>();
  register(provider: CloudProvider): void { if (!provider.id || this.providers.has(provider.id)) throw new Error("CLOUD_PROVIDER_DUPLICATE"); this.providers.set(provider.id,provider); }
  get(id: string): CloudProvider { const p = this.providers.get(id); if (!p) throw new Error("CLOUD_PROVIDER_UNAVAILABLE"); return p; }
  list(): string[] { return [...this.providers.keys()].sort(); }
}
export async function verifyLiveDeployment(provider: CloudProvider, plan: DeploymentPlan, receipt: DeploymentReceipt, fetchImpl: typeof fetch = fetch): Promise<LiveVerificationReceipt> {
  verifyDeploymentPlan(plan);
  const { receipt_sha256, ...body } = receipt;
  if (digest(body) !== receipt_sha256 || receipt.schema !== "osa.deployment_receipt.v1" || receipt.plan_sha256 !== plan.plan_sha256 || receipt.provider !== plan.provider || provider.id !== plan.provider || receipt.target !== plan.target || receipt.image !== plan.image || receipt.mission_id !== plan.mission_id || receipt.organization_id !== plan.organization_id || receipt.project_id !== plan.project_id) throw new Error("DEPLOYMENT_RECEIPT_INVALID");
  const status = await provider.status(plan);
  if (status.state !== "READY" || status.target !== plan.target || status.image !== plan.image || !status.url || !/^[a-f0-9]{64}$/.test(status.evidence_sha256)) throw new Error("DEPLOYMENT_NOT_READY");
  const url = new URL(plan.health_path,status.url);
  // Provider status is trusted infrastructure input. No caller-supplied arbitrary health URL.
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname.replace(/^\[|\]$/g,"")) !== 0 || !url.hostname.includes(".") || /\.(local|internal|localhost)$/.test(url.hostname)) throw new Error("LIVE_ENDPOINT_DENIED");
  const response = await fetchImpl(url,{ redirect: "error", signal: AbortSignal.timeout(15000) });
  const text = await readBoundedResponse(response,1024*1024);
  if (response.status !== 200 || digest(text) !== plan.expected_body_sha256) throw new Error("LIVE_VALIDATION_FAILED");
  const verified: Omit<LiveVerificationReceipt,"receipt_sha256"> = { schema: "osa.live_verification_receipt.v1", organization_id: plan.organization_id, project_id: plan.project_id, mission_id: plan.mission_id, deployment_receipt_sha256: receipt_sha256, plan_sha256: plan.plan_sha256, url: url.toString(), http_status: response.status, body_sha256: digest(text), resource_evidence_sha256: status.evidence_sha256, verified_at: new Date().toISOString() };
  return { ...verified, receipt_sha256: digest(verified) };
}
export async function readBoundedResponse(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { value,done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) throw new Error("RESPONSE_TOO_LARGE"); chunks.push(value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
