import { DockerWorkspaceProvider, cleanupManagedDockerWorkspaces } from "../../../packages/workspace-runtime/src/docker";
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

  const host = env.HOST?.trim() || "0.0.0.0";
  const provider = new DockerWorkspaceProvider({
    dockerBinary: env.DOCKER_BIN,
    image: env.OSA_WORKSPACE_DOCKER_IMAGE,
    network: env.OSA_WORKSPACE_DOCKER_NETWORK,
  });

  const cleaned = await cleanupManagedDockerWorkspaces({
    dockerBinary: env.DOCKER_BIN,
  });

  const server = createWorkerServer({ token, provider });
  server.listen(port, host, () => {
    console.log(
      JSON.stringify({
        service: "osa-worker-host",
        version: "v0.1",
        provider: provider.id,
        cleaned_orphaned_workspaces: cleaned,
        host,
        port,
      })
    );
  });

  return server;
}

if (require.main === module) {
  try {
    void startWorkerHost();
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "osa-worker-host",
        error: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    process.exit(1);
  }
}
