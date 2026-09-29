import { Buffer } from "node:buffer";
import type {
  WorkspaceCommandOptions,
  WorkspaceCommandResult,
  WorkspaceCreateRequest,
  WorkspaceHandle,
  WorkspaceProvider,
} from "./index";

type FetchLike = typeof fetch;

export interface RemoteWorkspaceProviderOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

interface RemoteWorkspaceDescriptor {
  id: string;
  rootDir: string;
  metadata?: Record<string, unknown>;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OSA_WORKER_BASE_URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

async function requestJson<T>(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`OSA_WORKER_NON_JSON_RESPONSE: HTTP ${response.status}`);
      }
    }

    if (!response.ok) {
      const record =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {};
      const detail =
        typeof record.error === "string"
          ? record.error
          : typeof record.message === "string"
            ? record.message
            : `HTTP ${response.status}`;
      throw new Error(`OSA_WORKER_REQUEST_FAILED: ${detail}`);
    }

    return body as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`OSA_WORKER_REQUEST_TIMEOUT: ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class RemoteWorkspaceHandle implements WorkspaceHandle {
  readonly id: string;
  readonly rootDir: string;
  readonly metadata?: Record<string, unknown>;
  private stopped = false;

  constructor(
    descriptor: RemoteWorkspaceDescriptor,
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike,
    private readonly requestTimeoutMs: number
  ) {
    this.id = descriptor.id;
    this.rootDir = descriptor.rootDir;
    this.metadata = descriptor.metadata;
  }

  async exec(
    command: string,
    args: readonly string[] = [],
    options: WorkspaceCommandOptions = {}
  ): Promise<WorkspaceCommandResult> {
    if (this.stopped) {
      return { exitCode: 125, stdout: "", stderr: "WORKSPACE_STOPPED" };
    }

    return requestJson<WorkspaceCommandResult>(
      this.fetchImpl,
      `${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.id)}/exec`,
      this.token,
      {
        method: "POST",
        body: JSON.stringify({
          command,
          args: [...args],
          options,
        }),
      },
      options.timeoutMs ?? this.requestTimeoutMs
    );
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.stopped) throw new Error("WORKSPACE_STOPPED");

    const bytes =
      typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);

    await requestJson<{ ok: true }>(
      this.fetchImpl,
      `${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.id)}/files`,
      this.token,
      {
        method: "PUT",
        body: JSON.stringify({
          path,
          encoding: "base64",
          content: bytes.toString("base64"),
        }),
      },
      this.requestTimeoutMs
    );
  }

  async exposePort(port: number): Promise<string | undefined> {
    if (this.stopped) return undefined;
    const result = await requestJson<{ url?: string }>(
      this.fetchImpl,
      `${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.id)}/ports/${port}`,
      this.token,
      { method: "GET" },
      this.requestTimeoutMs
    );
    return result.url;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;

    await requestJson<{ ok: true }>(
      this.fetchImpl,
      `${this.baseUrl}/v1/workspaces/${encodeURIComponent(this.id)}`,
      this.token,
      { method: "DELETE" },
      this.requestTimeoutMs
    );
    this.stopped = true;
  }
}

export class RemoteWorkspaceProvider implements WorkspaceProvider {
  readonly id = "remote";
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(options: RemoteWorkspaceProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.token.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;

    if (!this.token) throw new Error("OSA_WORKER_TOKEN is required");
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error("OSA_WORKER_REQUEST_TIMEOUT_MS must be a positive integer");
    }
  }

  async create(request: WorkspaceCreateRequest): Promise<WorkspaceHandle> {
    const result = await requestJson<{ workspace: RemoteWorkspaceDescriptor }>(
      this.fetchImpl,
      `${this.baseUrl}/v1/workspaces`,
      this.token,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      Math.min(request.timeoutMs, this.requestTimeoutMs)
    );

    if (!result.workspace?.id || !result.workspace.rootDir) {
      throw new Error("OSA_WORKER_INVALID_WORKSPACE_RESPONSE");
    }

    return new RemoteWorkspaceHandle(
      result.workspace,
      this.baseUrl,
      this.token,
      this.fetchImpl,
      this.requestTimeoutMs
    );
  }
}

export function createRemoteWorkspaceProvider(
  options: RemoteWorkspaceProviderOptions
): RemoteWorkspaceProvider {
  return new RemoteWorkspaceProvider(options);
}
