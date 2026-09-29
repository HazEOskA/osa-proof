export interface WorkspaceCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface WorkspaceCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface WorkspaceCreateRequest {
  workspaceId: string;
  timeoutMs: number;
  runtime?: string;
  cpu?: number;
  memoryMb?: number;
  ports?: number[];
}

export interface WorkspaceHandle {
  readonly id: string;
  readonly rootDir: string;
  readonly metadata?: Record<string, unknown>;

  exec(
    command: string,
    args?: readonly string[],
    options?: WorkspaceCommandOptions
  ): Promise<WorkspaceCommandResult>;

  writeFile(path: string, content: string | Uint8Array): Promise<void>;

  exposePort?(port: number): Promise<string | undefined>;

  stop(): Promise<void>;
}

export interface WorkspaceProvider {
  readonly id: string;

  create(request: WorkspaceCreateRequest): Promise<WorkspaceHandle>;
}

export class WorkspaceProviderRegistry {
  private readonly providers = new Map<string, WorkspaceProvider>();

  register(provider: WorkspaceProvider): void {
    if (!provider.id.trim()) throw new Error("workspace provider id is required");
    if (this.providers.has(provider.id)) {
      throw new Error(`workspace provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): WorkspaceProvider | undefined {
    return this.providers.get(providerId);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  list(): string[] {
    return [...this.providers.keys()].sort();
  }
}

export const workspaceProviders = new WorkspaceProviderRegistry();

export class WorkspaceProviderNotConfiguredError extends Error {
  constructor(providerId: string) {
    super(`WORKSPACE_PROVIDER_NOT_CONFIGURED: ${providerId}`);
    this.name = "WorkspaceProviderNotConfiguredError";
  }
}


export { DockerWorkspaceProvider, createDockerWorkspaceProvider } from "./docker";

export function registerBuiltInWorkspaceProviders(env: Record<string, string | undefined> = process.env): void {
  if (!workspaceProviders.has("docker")) {
    const { DockerWorkspaceProvider } = require("./docker") as typeof import("./docker");
    workspaceProviders.register(
      new DockerWorkspaceProvider({
        image: env.OSA_WORKSPACE_DOCKER_IMAGE,
        network: env.OSA_WORKSPACE_DOCKER_NETWORK,
        dockerBinary: env.DOCKER_BIN,
      })
    );
  }
}
