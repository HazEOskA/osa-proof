import { AgentExecutor } from "../../contracts/src";
import { DockerImagePublisher } from "./image";
import { CloudProvider, CloudGrant, BuildReceipt, prepareDeployment, verifyLiveDeployment } from "./index";
/** Explicit composition of existing AgentExecutor with publishing/deploying. Not installed in the preview registry. */
export function applicationDeploymentExecutor(options: {
  publisher: DockerImagePublisher; provider: CloudProvider; target: string; registry: string;
  registryGrant: (build: BuildReceipt) => Parameters<DockerImagePublisher["publish"]>[2];
  cloudGrant: (plan: ReturnType<typeof prepareDeployment>) => CloudGrant;
  expectedBodySha256: string; healthPath: string; fetchImpl?: typeof fetch;
}): AgentExecutor {
  return async context => {
    const input = context.input as { build_receipt?: BuildReceipt; artifact?: string };
    if (!input?.build_receipt || typeof input.artifact !== "string" || input.build_receipt.mission_id !== context.mission.mission_id || input.build_receipt.organization_id !== context.mission.organization_id || input.build_receipt.project_id !== context.mission.project_id) throw new Error("DEPLOYMENT_INPUT_SCOPE_DENIED");
    const build = structuredClone(input.build_receipt);
    const image = await options.publisher.publish(build,input.artifact,options.registryGrant(build));
    const plan = prepareDeployment({ organization_id: context.mission.organization_id, project_id: context.mission.project_id, mission_id: context.mission.mission_id, provider: options.provider.id, target: options.target, image: image.image, image_receipt: image, build, health_path: options.healthPath, expected_body_sha256: options.expectedBodySha256 });
    await options.provider.validate(plan);
    const deployed = await options.provider.deploy(plan,options.cloudGrant(plan));
    // No success from HTTP 202 / an image existing. Caller may retry verification after provider becomes READY.
    const verified = await verifyLiveDeployment(options.provider,plan,deployed,options.fetchImpl);
    return { output: { url: verified.url, plan, verification_receipt: verified }, evidence: [
      {kind:"build_receipt",data:{receipt:build}}, {kind:"image_receipt",data:{receipt:image}},
      {kind:"deployment_receipt",data:{receipt:deployed}}, {kind:"live_verification_receipt",data:{status:"verified",receipt:verified}},
    ] };
  };
}
