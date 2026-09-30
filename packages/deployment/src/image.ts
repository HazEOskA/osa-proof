import { randomUUID } from "node:crypto";
import { DockerCli } from "../../workspace-runtime/src/docker";
import { BuildReceipt, MissionScope, verifyBuildReceipt } from "./index";
import { digest } from "../../proof-core/src";
export interface ImageReceipt extends MissionScope { schema: "osa.image_receipt.v1"; build_receipt_sha256: string; image: string; created_at: string; receipt_sha256: string }
/** Trusted host daemon boundary. It is never mounted into an agent sandbox. Single-file Node artifact profile. */
export class DockerImagePublisher {
  constructor(private readonly cli: DockerCli, private readonly registry: string, private readonly baseImage: string) {
    if (!/^[a-z0-9.-]+(?:\/[a-z0-9_-]+)+$/.test(registry) || !/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(baseImage)) throw new Error("IMAGE_PUBLISHER_CONFIG_INVALID");
  }
  async publish(build: BuildReceipt, artifact: string, grant: MissionScope & { permission: "registry.push"; build_receipt_sha256: string; registry: string }): Promise<ImageReceipt> {
    verifyBuildReceipt(build);
    if (grant.organization_id !== build.organization_id || grant.project_id !== build.project_id || grant.mission_id !== build.mission_id || grant.permission !== "registry.push" || grant.registry !== this.registry || grant.build_receipt_sha256 !== build.receipt_sha256 || digest(artifact) !== build.artifact_sha256 || Buffer.byteLength(artifact) > 1400000 || Buffer.from(artifact,"base64").toString("base64") !== artifact) throw new Error("REGISTRY_PERMISSION_DENIED");
    const tag = `${this.registry}:osa-${randomUUID()}`;
    const context = tarFiles({ Dockerfile: Buffer.from(`FROM ${this.baseImage}\nWORKDIR /app\nCOPY app.js /app/app.js\nUSER 1000:1000\nEXPOSE 3000\nCMD ["node","/app/app.js"]\n`), "app.js": Buffer.from(artifact,"base64") });
    const compiled = await this.cli.run(["build","--network=none","-t",tag,"-"],{ stdin: context, timeoutMs: 120000 });
    if (compiled.exitCode !== 0) throw new Error("IMAGE_BUILD_FAILED");
    const pushed = await this.cli.run(["push",tag],{ timeoutMs: 120000 });
    if (pushed.exitCode !== 0) throw new Error("IMAGE_PUSH_FAILED");
    const inspected = await this.cli.run(["image","inspect",tag,"--format","{{json .RepoDigests}}"],{ timeoutMs: 30000 });
    if (inspected.exitCode !== 0) throw new Error("IMAGE_DIGEST_UNAVAILABLE");
    const values: unknown = JSON.parse(inspected.stdout);
    const image = Array.isArray(values) && values.find(v => typeof v === "string" && v.startsWith(`${this.registry}@sha256:`) && /^[a-f0-9]{64}$/.test(v.split("@sha256:")[1]));
    if (!image) throw new Error("IMAGE_DIGEST_UNAVAILABLE");
    const body = { schema: "osa.image_receipt.v1" as const, organization_id: build.organization_id, project_id: build.project_id, mission_id: build.mission_id, build_receipt_sha256: build.receipt_sha256, image: image as string, created_at: new Date().toISOString() };
    return { ...body, receipt_sha256: digest(body) };
  }
}
// Fixed two-file USTAR context: no host paths, traversal, symlinks or arbitrary Dockerfile from the agent.
function tarFiles(files: Record<string,Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name,bytes] of Object.entries(files)) {
    const header = Buffer.alloc(512); header.write(name,0,100,"ascii");
    const octal = (value: number,length: number) => value.toString(8).padStart(length-1,"0")+"\0";
    header.write(octal(0o644,8),100); header.write(octal(0,8),108); header.write(octal(0,8),116); header.write(octal(bytes.length,12),124); header.write(octal(0,12),136); header.fill(32,148,156); header.write("0",156); header.write("ustar\0",257); header.write("00",263);
    const checksum = header.reduce((sum,b) => sum+b,0); header.write(checksum.toString(8).padStart(6,"0")+"\0 ",148);
    chunks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  chunks.push(Buffer.alloc(1024)); return Buffer.concat(chunks);
}
