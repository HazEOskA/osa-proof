import { DockerWorkspaceProvider } from "../../../packages/workspace-runtime/src/docker";
import { createWorkerServer } from "./index";

type Env = Record<string, string | undefined>;

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export async function startWorkerHost(env: Env = process.env) {
  const token = env.OSA_WORKER_TOKEN?.trim();
  if (!token) throw new Error("OSA_WORKER_TOKEN is required");

  const port = positiveInteger(env.PORT, 8787, "PORT");
  if (port > 65535) throw new Error("PORT must be <= 65535");

  const host = env.HOST?.trim() || "127.0.0.1";
  const provider = new DockerWorkspaceProvider({
    dockerBinary: env.DOCKER_BIN,
    image: env.OSA_WORKSPACE_DOCKER_IMAGE,
    network: env.OSA_WORKSPACE_DOCKER_NETWORK,
  });

  const organization_id = env.OSA_WORKER_ORGANIZATION_ID;
  const project_id = env.OSA_WORKER_PROJECT_ID;
  if (!organization_id || !project_id || token.length < 32) throw new Error("Scoped worker credentials (32+ chars), organization and project are required");
  const server = createWorkerServer({ token, provider, scope: { organization_id, project_id }, maxWorkspaces: positiveInteger(env.OSA_WORKER_CAPACITY, 4, "OSA_WORKER_CAPACITY") });
  server.listen(port, host, () => {
    console.log(
      JSON.stringify({
        service: "osa-worker-host",
        version: "v0.1",
        provider: provider.id,
        cleanup_policy: "scoped handle lifecycle; no global startup deletion",
        host,
        port,
      })
    );
  });

  return server;
}

if (require.main === module) {
  void startWorkerHost().catch((error) => {
    console.error(
      JSON.stringify({
        service: "osa-worker-host",
        error: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    process.exit(1);
  });
}
