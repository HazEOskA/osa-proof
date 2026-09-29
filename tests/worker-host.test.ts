import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createWorkerServer, WorkerState } from "../apps/worker/src";
import {
  RemoteWorkspaceProvider,
  type WorkspaceCommandOptions,
  type WorkspaceCommandResult,
  type WorkspaceCreateRequest,
  type WorkspaceHandle,
  type WorkspaceProvider,
} from "../packages/workspace-runtime/src";

class FakeWorkspace implements WorkspaceHandle {
  readonly rootDir = "/workspace";
  readonly metadata = { provider: "fake" };
  stopped = false;
  files = new Map<string, string>();

  constructor(readonly id: string) {}

  async exec(
    command: string,
    args: readonly string[] = [],
    options: WorkspaceCommandOptions = {}
  ): Promise<WorkspaceCommandResult> {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ command, args, options }),
      stderr: "",
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.files.set(
      path,
      typeof content === "string" ? content : Buffer.from(content).toString("utf8")
    );
  }

  async exposePort(port: number): Promise<string> {
    return `http://127.0.0.1:${port + 10000}`;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

class FakeProvider implements WorkspaceProvider {
  readonly id = "fake";
  latest?: FakeWorkspace;

  async create(request: WorkspaceCreateRequest): Promise<WorkspaceHandle> {
    this.latest = new FakeWorkspace(`ws-${request.workspaceId}`);
    return this.latest;
  }
}

async function startFakeWorker(token = "worker-secret") {
  const provider = new FakeProvider();
  const state = new WorkerState();
  const server = createWorkerServer({ token, provider }, state);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    provider,
    state,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test("OSA Worker Host health is public but workspace API fails closed", async () => {
  const worker = await startFakeWorker();
  try {
    const health = await fetch(`${worker.baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as Record<string, unknown>;
    assert.equal(healthBody.service, "osa-worker-host");
    assert.equal(healthBody.status, "ready");

    const unauthorized = await fetch(`${worker.baseUrl}/v1/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "unauthorized",
        timeoutMs: 60_000,
      }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(worker.state.count(), 0);
  } finally {
    await worker.close();
  }
});

test("RemoteWorkspaceProvider drives worker create/exec/write/port/stop lifecycle", async () => {
  const token = "worker-secret";
  const worker = await startFakeWorker(token);

  try {
    const provider = new RemoteWorkspaceProvider({
      baseUrl: worker.baseUrl,
      token,
      requestTimeoutMs: 5_000,
    });

    const workspace = await provider.create({
      workspaceId: "remote-v01",
      timeoutMs: 60_000,
      cpu: 2,
      memoryMb: 1024,
      ports: [3000],
    });

    assert.equal(workspace.id, "ws-remote-v01");
    assert.equal(workspace.rootDir, "/workspace");
    assert.equal(worker.state.count(), 1);

    const exec = await workspace.exec("node", ["-v"], {
      cwd: "/workspace/project",
      env: { TEST_ENV: "1" },
      timeoutMs: 2_000,
    });
    assert.equal(exec.exitCode, 0);
    const echoed = JSON.parse(exec.stdout) as Record<string, unknown>;
    assert.equal(echoed.command, "node");

    await workspace.writeFile(
      "/workspace/project/hello.txt",
      "worker-host-v0.1"
    );
    assert.equal(
      worker.provider.latest?.files.get("/workspace/project/hello.txt"),
      "worker-host-v0.1"
    );

    assert.equal(
      await workspace.exposePort?.(3000),
      "http://127.0.0.1:13000"
    );

    await workspace.stop();
    assert.equal(worker.provider.latest?.stopped, true);
    assert.equal(worker.state.count(), 0);
  } finally {
    await worker.close();
  }
});

test("RemoteWorkspaceProvider rejects wrong worker token", async () => {
  const worker = await startFakeWorker("correct-token");
  try {
    const provider = new RemoteWorkspaceProvider({
      baseUrl: worker.baseUrl,
      token: "wrong-token",
    });

    await assert.rejects(
      () =>
        provider.create({
          workspaceId: "denied",
          timeoutMs: 60_000,
        }),
      /unauthorized/
    );
  } finally {
    await worker.close();
  }
});

test("OSA Worker Host restricts file writes to /workspace", async () => {
  const token = "worker-secret";
  const worker = await startFakeWorker(token);

  try {
    const create = await fetch(`${worker.baseUrl}/v1/workspaces`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: "path-check",
        timeoutMs: 60_000,
      }),
    });
    const body = (await create.json()) as {
      workspace: { id: string };
    };

    const denied = await fetch(
      `${worker.baseUrl}/v1/workspaces/${encodeURIComponent(body.workspace.id)}/files`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          path: "/etc/osa-secret",
          encoding: "base64",
          content: Buffer.from("no").toString("base64"),
        }),
      }
    );

    assert.equal(denied.status, 400);
    const deniedBody = (await denied.json()) as { error: string };
    assert.match(deniedBody.error, /inside \/workspace/);
  } finally {
    await worker.close();
  }
});
