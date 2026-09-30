import { spawn } from "node:child_process";
import { posix } from "node:path";
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
    .replace(/[-._]+$/g, "")
    .slice(0, 45)
    .replace(/[-._]+$/g, "");
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
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (target: Buffer[], chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes <= 4 * 1024 * 1024) target.push(Buffer.from(chunk)); else { truncated = true; child.kill("SIGKILL"); } };
      child.stdout.on("data", (chunk) => append(stdout, chunk));
      child.stderr.on("data", (chunk) => append(stderr, chunk));

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
          exitCode: truncated ? 125 : exitCode,
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

      child.stdin.on("error", () => { child.kill("SIGKILL"); });
      if (options.stdin !== undefined) child.stdin.end(options.stdin);
      else child.stdin.end();
    });
  }
}

class DockerWorkspaceHandle implements WorkspaceHandle {
  readonly rootDir = "/workspace";
  readonly metadata: Record<string, unknown>;
  private stopped = false;
  private readonly lifetimeTimer?: NodeJS.Timeout;

  constructor(
    readonly id: string,
    private readonly containerName: string,
    private readonly cli: DockerCli,
    metadata: Record<string, unknown>,
    lifetimeMs?: number
  ) {
    this.metadata = metadata;
    if (lifetimeMs && lifetimeMs > 0) {
      this.lifetimeTimer = setTimeout(() => {
        void this.stop().catch(() => undefined);
      }, lifetimeMs);
      this.lifetimeTimer.unref();
    }
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

    if (!command || command.includes("\0") || args.some(a => typeof a !== "string" || a.includes("\0"))) throw new Error("WORKSPACE_COMMAND_INVALID");
    if (options.cwd) safePath(options.cwd);
    if (Object.keys(options.env ?? {}).some(k => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) throw new Error("WORKSPACE_ENV_INVALID");
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 86400000)) throw new Error("WORKSPACE_TIMEOUT_INVALID");
    const dockerArgs: string[] = ["exec"];

    if (options.cwd) dockerArgs.push("-w", options.cwd);
    for (const [key, value] of Object.entries(options.env ?? {})) {
      dockerArgs.push("-e", `${key}=${value}`);
    }

    dockerArgs.push(this.containerName, command, ...args);
    const result = await this.cli.run(dockerArgs, { timeoutMs: options.timeoutMs ?? 120000 });
    if (result.exitCode === 124 || result.exitCode === 125) await this.stop();
    return result;
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.stopped) throw new Error("WORKSPACE_STOPPED");
    safePath(path);
    if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error("WORKSPACE_FILE_TOO_LARGE");

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
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer);

    const result = await this.cli.run(["rm", "-f", this.containerName]);
    if (result.exitCode !== 0 && !/No such container/i.test(result.stderr)) {
      throw new Error(`WORKSPACE_STOP_FAILED: ${result.stderr.trim() || result.exitCode}`);
    }
    this.stopped = true;
  }
}

function safePath(path: string): void {
  if (path.includes("\0") || !path.startsWith("/workspace/") || posix.normalize(path) !== path || path.split("/").includes("..")) throw new Error("WORKSPACE_PATH_INVALID");
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
      "none";
    this.defaultPorts = options.defaultPorts ?? [];
    this.cli =
      options.cli ??
      new SpawnDockerCli(options.dockerBinary?.trim() || process.env.DOCKER_BIN?.trim() || "docker");
  }

  async create(request: WorkspaceCreateRequest): Promise<WorkspaceHandle> {
    if (!request.workspaceId || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1000 || request.timeoutMs > 86400000 || (request.cpu !== undefined && (!Number.isFinite(request.cpu) || request.cpu < 0.25 || request.cpu > 8)) || (request.memoryMb !== undefined && (!Number.isInteger(request.memoryMb) || request.memoryMb < 128 || request.memoryMb > 8192))) throw new Error("WORKSPACE_LIMIT_INVALID");
    if (request.scope && Object.values(request.scope).some(v => !/^[A-Za-z0-9_.:-]{1,128}$/.test(v))) throw new Error("WORKSPACE_SCOPE_INVALID");
    const containerName = `osa-${sanitizeContainerName(request.workspaceId)}-${randomUUID().slice(0, 8)}`;
    const cpu = Math.max(0.25, request.cpu ?? 1);
    const memoryMb = clampPositiveInteger(request.memoryMb, 2048);
    const ports = request.ports ?? this.defaultPorts;

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
      "--pids-limit",
      "512",
      "--security-opt",
      "no-new-privileges:true",
      "--cap-drop",
      "ALL",
      "--read-only",
      "--user", "1000:1000",
      "--tmpfs", "/workspace:rw,nosuid,nodev,uid=1000,gid=1000,size=512m",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m",
      "--env", "HOME=/workspace",
      "--init",
      "--network",
      this.network,
      "--workdir",
      "/workspace",
    ];

    for (const [key, value] of Object.entries(request.scope ?? {})) args.push("--label", `osa.${key}=${value}`);
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
      await this.cli.run(["rm", "-f", containerName]);
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
        scope: request.scope ?? null,
        isolation: "docker-process",
        image: this.image,
        network: this.network,
        container_name: containerName,
        container_id: containerId || null,
        cpu,
        memory_mb: memoryMb,
        ports: [...ports],
        lifetime_ms: request.timeoutMs,
      },
      request.timeoutMs
    );
  }
}

export function createDockerWorkspaceProvider(
  options: DockerWorkspaceProviderOptions = {}
): DockerWorkspaceProvider {
  return new DockerWorkspaceProvider(options);
}

export async function cleanupManagedDockerWorkspaces(
  options: Pick<DockerWorkspaceProviderOptions, "dockerBinary" | "cli"> & { scope: { organization_id: string; project_id: string; mission_id: string } }
): Promise<number> {
  const cli =
    options.cli ??
    new SpawnDockerCli(
      options.dockerBinary?.trim() || process.env.DOCKER_BIN?.trim() || "docker"
    );

  if (!options.scope || Object.values(options.scope).some(v => !/^[A-Za-z0-9_.:-]{1,128}$/.test(v))) throw new Error("WORKSPACE_CLEANUP_SCOPE_REQUIRED");
  const listed = await cli.run([
    "ps",
    "-aq",
    "--filter",
    "label=osa.managed=true",
    "--filter", `label=osa.organization_id=${options.scope.organization_id}`,
    "--filter", `label=osa.project_id=${options.scope.project_id}`,
    "--filter", `label=osa.mission_id=${options.scope.mission_id}`,
  ]);

  if (listed.exitCode !== 0) {
    throw new Error(
      `WORKSPACE_CLEANUP_LIST_FAILED: ${listed.stderr.trim() || listed.exitCode}`
    );
  }

  const ids = listed.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (ids.length === 0) return 0;

  const removed = await cli.run(["rm", "-f", ...ids]);
  if (removed.exitCode !== 0) {
    throw new Error(
      `WORKSPACE_CLEANUP_REMOVE_FAILED: ${removed.stderr.trim() || removed.exitCode}`
    );
  }

  return ids.length;
}

export const __dockerWorkspaceInternals = {
  parsePublishedPort,
  sanitizeContainerName,
};
