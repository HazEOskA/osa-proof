import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { posix as pathPosix } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  WorkspaceCommandOptions,
  WorkspaceCreateRequest,
  WorkspaceHandle,
  WorkspaceProvider,
} from "../../../packages/workspace-runtime/src";

const MAX_JSON_BYTES = 16 * 1024 * 1024;

interface WorkspaceRecord {
  handle: WorkspaceHandle;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export interface WorkerServerOptions {
  token: string;
  provider: WorkspaceProvider;
  now?: () => number;
  scope?: { organization_id: string; project_id: string };
  maxWorkspaces?: number;
}

export class WorkerState {
  creating = 0;
  readonly workspaces = new Map<string, WorkspaceRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  add(handle: WorkspaceHandle, lifetimeMs: number): void {
    const existing = this.workspaces.get(handle.id);
    if (existing) clearTimeout(existing.timer);

    const expiresAt = this.now() + lifetimeMs;
    const timer = setTimeout(() => {
      void handle.stop().then(() => this.workspaces.delete(handle.id)).catch(() => undefined);
    }, lifetimeMs);
    timer.unref();

    this.workspaces.set(handle.id, { handle, expiresAt, timer });
  }

  get(id: string): WorkspaceHandle | undefined {
    return this.workspaces.get(id)?.handle;
  }

  describe(id: string): Record<string, unknown> | undefined {
    const record = this.workspaces.get(id);
    if (!record) return undefined;
    return {
      id: record.handle.id,
      rootDir: record.handle.rootDir,
      metadata: record.handle.metadata,
      expires_at: new Date(record.expiresAt).toISOString(),
    };
  }

  async remove(id: string): Promise<boolean> {
    const record = this.workspaces.get(id);
    if (!record) return false;

    clearTimeout(record.timer);
    await record.handle.stop();
    this.workspaces.delete(id);
    return true;
  }

  count(): number {
    return this.workspaces.size;
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  return safeTokenEqual(authorization.slice("Bearer ".length).trim(), expectedToken);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) throw new Error("REQUEST_BODY_REQUIRED");
  return JSON.parse(raw) as T;
}

function assertCreateRequest(value: unknown): asserts value is WorkspaceCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_WORKSPACE_CREATE_REQUEST");
  }

  const request = value as Record<string, unknown>;
  if (typeof request.workspaceId !== "string" || !request.workspaceId.trim()) {
    throw new Error("workspaceId is required");
  }

  if (
    typeof request.timeoutMs !== "number" ||
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < 1_000 ||
    request.timeoutMs > 24 * 60 * 60_000
  ) {
    throw new Error("timeoutMs must be an integer between 1000 and 86400000");
  }

  if (
    request.cpu !== undefined &&
    (typeof request.cpu !== "number" || !Number.isFinite(request.cpu) || request.cpu <= 0 || request.cpu > 32)
  ) {
    throw new Error("cpu must be between 0 and 32");
  }

  if (
    request.memoryMb !== undefined &&
    (typeof request.memoryMb !== "number" ||
      !Number.isInteger(request.memoryMb) ||
      request.memoryMb < 128 ||
      request.memoryMb > 131072)
  ) {
    throw new Error("memoryMb must be between 128 and 131072");
  }

  if (
    request.ports !== undefined &&
    (!Array.isArray(request.ports) ||
      request.ports.some(
        (port) => !Number.isInteger(port) || Number(port) <= 0 || Number(port) > 65535
      ))
  ) {
    throw new Error("ports must contain valid TCP ports");
  }
}

function assertExecBody(value: unknown): asserts value is {
  command: string;
  args?: string[];
  options?: WorkspaceCommandOptions;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_EXEC_REQUEST");
  }

  const body = value as Record<string, unknown>;
  if (typeof body.command !== "string" || !body.command.trim()) {
    throw new Error("command is required");
  }

  if (
    body.args !== undefined &&
    (!Array.isArray(body.args) || body.args.some((item) => typeof item !== "string"))
  ) {
    throw new Error("args must be an array of strings");
  }

  if (
    body.options !== undefined &&
    (!body.options || typeof body.options !== "object" || Array.isArray(body.options))
  ) {
    throw new Error("options must be an object");
  }

  const options = body.options as Record<string, unknown> | undefined;
  if (
    options?.env !== undefined &&
    (!options.env ||
      typeof options.env !== "object" ||
      Array.isArray(options.env) ||
      Object.values(options.env as Record<string, unknown>).some(
        (item) => typeof item !== "string"
      ))
  ) {
    throw new Error("options.env must contain string values");
  }
}

function assertFileBody(value: unknown): asserts value is {
  path: string;
  encoding: "base64";
  content: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_FILE_REQUEST");
  }

  const body = value as Record<string, unknown>;
  if (typeof body.path !== "string") {
    throw new Error("file path must be inside /workspace");
  }
  const normalizedPath = pathPosix.normalize(body.path);
  if (
    normalizedPath === "/workspace" ||
    !normalizedPath.startsWith("/workspace/")
  ) {
    throw new Error("file path must be inside /workspace");
  }
  body.path = normalizedPath;
  if (body.encoding !== "base64" || typeof body.content !== "string") {
    throw new Error("file content must use base64 encoding");
  }
}

export async function handleWorkerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkerServerOptions,
  state = new WorkerState(options.now)
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/health") {
    return send(response, 200, {
      service: "osa-worker-host",
      version: "v0.1",
      status: "ready",
      provider: options.provider.id,
      active_workspaces: state.count(),
    });
  }

  if (!authorized(request, options.token)) {
    return send(response, 401, { error: "unauthorized" });
  }

  try {
    if (method === "POST" && url.pathname === "/v1/workspaces") {
      const body = await readJson<unknown>(request);
      assertCreateRequest(body);

      if (options.scope && (!body.scope || body.scope.organization_id !== options.scope.organization_id || body.scope.project_id !== options.scope.project_id)) return send(response, 403, { error: "WORKER_SCOPE_DENIED" });
      if (state.count() + state.creating >= (options.maxWorkspaces ?? 4)) return send(response, 429, { error: "WORKER_CAPACITY_EXCEEDED" });
      state.creating++;
      let handle: WorkspaceHandle;
      try { handle = await options.provider.create(body); state.add(handle, body.timeoutMs); }
      finally { state.creating--; }

      return send(response, 201, {
        workspace: state.describe(handle.id),
      });
    }

    if (parts[0] === "v1" && parts[1] === "workspaces" && parts[2]) {
      const workspaceId = decodeURIComponent(parts[2]);

      if (method === "DELETE" && parts.length === 3) {
        const removed = await state.remove(workspaceId);
        return send(response, 200, { ok: true, removed });
      }

      const workspace = state.get(workspaceId);
      if (!workspace) return send(response, 404, { error: "workspace not found" });

      if (method === "POST" && parts.length === 4 && parts[3] === "exec") {
        const body = await readJson<unknown>(request);
        assertExecBody(body);
        const result = await workspace.exec(
          body.command,
          body.args ?? [],
          body.options ?? {}
        );
        return send(response, 200, result);
      }

      if (method === "PUT" && parts.length === 4 && parts[3] === "files") {
        const body = await readJson<unknown>(request);
        assertFileBody(body);
        await workspace.writeFile(body.path, Buffer.from(body.content, "base64"));
        return send(response, 200, { ok: true });
      }

      if (
        method === "GET" &&
        parts.length === 5 &&
        parts[3] === "ports"
      ) {
        const port = Number(parts[4]);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          return send(response, 400, { error: "invalid port" });
        }
        const exposed = workspace.exposePort
          ? await workspace.exposePort(port)
          : undefined;
        return send(response, 200, { url: exposed });
      }

    }

    return send(response, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return send(response, 400, { error: message === "file path must be inside /workspace" ? message : message.startsWith("WORKSPACE_") || message.startsWith("INVALID_") ? message.split(":")[0] : "WORKER_REQUEST_FAILED" });
  }
}

export function createWorkerServer(
  options: WorkerServerOptions,
  state = new WorkerState(options.now)
): Server {
  if (!options.token.trim()) throw new Error("OSA_WORKER_TOKEN is required");
  if (options.maxWorkspaces !== undefined && (!Number.isInteger(options.maxWorkspaces) || options.maxWorkspaces < 1 || options.maxWorkspaces > 64)) throw new Error("WORKER_CAPACITY_INVALID");

  return createServer((request, response) => {
    void handleWorkerRequest(request, response, options, state);
  });
}
