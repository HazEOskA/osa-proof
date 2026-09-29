import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  WorkspaceCommandOptions,
  WorkspaceCommandResult,
  WorkspaceCreateRequest,
  WorkspaceHandle,
  WorkspaceProvider,
} from "./index";

export interface DockerCliRunOptions {
  stdin?: string | Uint8Array;
  timeoutMs?: number;
}

export interface DockerCli {
  run(args: readonly string[], options?: DockerCliRunOptions): Promise<WorkspaceCommandResult>;
}

export interface DockerWorkspaceProviderOptions {
  dockerBinary?: string;
  image?: string;
  network?: string;
  defaultPorts?: readonly number[];
  cli?: DockerCli;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function sanitizeContainerName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 45);
  return normalized || "workspace";
}

function parsePublishedPort(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return undefined;

  const ipv6 = line.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return `http://[${ipv6[1]}]:${ipv6[2]}`;

  const ipv4 = line.match(/^([^:]+):(\d+)$/);
  if (ipv4) return `http://${ipv4[1]}:${ipv4[2]}`;

  return undefined;
}

class SpawnDockerCli implements DockerCli {
  constructor(private readonly binary: string) {}

  run(args: readonly string[], options: DockerCliRunOptions = {}): Promise<WorkspaceCommandResult> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let timedOut = false;
      let settled = false;

      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

      const timeout =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill("SIGKILL");
            }, options.timeoutMs)
          : undefined;

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: timedOut
            ? `docker command timed out after ${options.timeoutMs}ms\n${Buffer.concat(stderr).toString("utf8")}`
            : Buffer.concat(stderr).toString("utf8"),
        });
      };

      child.on("error", (error) => {
        stderr.push(Buffer.from(error.message));
        finish(127);
      });
      child.on("close", (code) => finish(timedOut ? 124 : (code ?? 1)));

      if (options.stdin !== undefined) child.stdin.end(options.stdin);
      else child.stdin.end();
    });
  }
}

class DockerWorkspaceHandle implements WorkspaceHandle {
  readonly rootDir = "/workspace";
  readonly metadata: Record<string, unknown>;
  private stopped = false;

  constructor(
    readonly id: string,
    private readonly containerName: string,
    private readonly cli: DockerCli,
    metadata: Record<string, unknown>
  ) {
    this.metadata = metadata;
  }

  async exec(
    command: string,
    args: readonly string[] = [],
    options: WorkspaceCommandOptions = {}
  ): Promise<WorkspaceCommandResult> {
    if (this.stopped) {
      return {
        exitCode: 125,
        stdout: "",
        stderr: "WORKSPACE_STOPPED",
      };
    }

    const dockerArgs: string[] = ["exec"];

    if (options.cwd) dockerArgs.push("-w", options.cwd);
    for (const [key, value] of Object.entries(options.env ?? {})) {
      dockerArgs.push("-e", `${key}=${value}`);
    }

    dockerArgs.push(this.containerName, command, ...args);
    return this.cli.run(dockerArgs, { timeoutMs: options.timeoutMs });
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.stopped) throw new Error("WORKSPACE_STOPPED");

    const result = await this.cli.run(
      [
        "exec",
        "-i",
        this.containerName,
        "sh",
        "-lc",
        'mkdir -p -- "$(dirname "$1")" && cat > "$1"',
        "osa-write-file",
        path,
      ],
      { stdin: content }
    );

    if (result.exitCode !== 0) {
      throw new Error(`WORKSPACE_WRITE_FILE_FAILED: ${result.stderr.trim() || result.exitCode}`);
    }
  }

  async exposePort(port: number): Promise<string | undefined> {
    if (this.stopped) return undefined;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("WORKSPACE_PORT_INVALID");
    }

    const result = await this.cli.run([
      "port",
      this.containerName,
      `${port}/tcp`,
    ]);

    if (result.exitCode !== 0) return undefined;
    return parsePublishedPort(result.stdout);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    const result = await this.cli.run(["rm", "-f", this.containerName]);
    if (result.exitCode !== 0 && !/No such container/i.test(result.stderr)) {
      throw new Error(`WORKSPACE_STOP_FAILED: ${result.stderr.trim() || result.exitCode}`);
    }
  }
}

export class DockerWorkspaceProvider implements WorkspaceProvider {
  readonly id = "docker";
  private readonly image: string;
  private readonly network: string;
  private readonly defaultPorts: readonly number[];
  private readonly cli: DockerCli;

  constructor(options: DockerWorkspaceProviderOptions = {}) {
    this.image =
      options.image?.trim() ||
      process.env.OSA_WORKSPACE_DOCKER_IMAGE?.trim() ||
      "osa/workspace-node22:v0.1";
    this.network =
      options.network?.trim() ||
      process.env.OSA_WORKSPACE_DOCKER_NETWORK?.trim() ||
      "bridge";
    this.defaultPorts = options.defaultPorts ?? [3000, 5173];
    this.cli =
      options.cli ??
      new SpawnDockerCli(options.dockerBinary?.trim() || process.env.DOCKER_BIN?.trim() || "docker");
  }

  async create(request: WorkspaceCreateRequest): Promise<WorkspaceHandle> {
    const containerName = `osa-${sanitizeContainerName(request.workspaceId)}-${randomUUID().slice(0, 8)}`;
    const cpu = Math.max(0.25, request.cpu ?? 1);
    const memoryMb = clampPositiveInteger(request.memoryMb, 2048);
    const ports = request.ports?.length ? request.ports : this.defaultPorts;

    const args: string[] = [
      "run",
      "-d",
      "--name",
      containerName,
      "--label",
      "osa.managed=true",
      "--label",
      `osa.workspace.id=${request.workspaceId}`,
      "--cpus",
      String(cpu),
      "--memory",
      `${memoryMb}m`,
      "--network",
      this.network,
      "--workdir",
      "/workspace",
    ];

    for (const port of ports) {
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`WORKSPACE_PORT_INVALID: ${port}`);
      }
      args.push("-p", `127.0.0.1::${port}`);
    }

    args.push(this.image, "sh", "-lc", "mkdir -p /workspace/project && exec sleep infinity");

    const created = await this.cli.run(args, {
      timeoutMs: Math.min(request.timeoutMs, 120_000),
    });

    if (created.exitCode !== 0) {
      throw new Error(
        `WORKSPACE_CREATE_FAILED: ${created.stderr.trim() || created.stdout.trim() || created.exitCode}`
      );
    }

    const containerId = created.stdout.trim();
    return new DockerWorkspaceHandle(
      containerId || containerName,
      containerName,
      this.cli,
      {
        provider: this.id,
        image: this.image,
        network: this.network,
        container_name: containerName,
        container_id: containerId || null,
        cpu,
        memory_mb: memoryMb,
        ports: [...ports],
      }
    );
  }
}

export function createDockerWorkspaceProvider(
  options: DockerWorkspaceProviderOptions = {}
): DockerWorkspaceProvider {
  return new DockerWorkspaceProvider(options);
}

export const __dockerWorkspaceInternals = {
  parsePublishedPort,
  sanitizeContainerName,
};
