import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createWorkerServer } from "../apps/worker/src";
import { DockerWorkspaceProvider } from "../packages/workspace-runtime/src/docker";
import { RemoteWorkspaceProvider } from "../packages/workspace-runtime/src/remote";

const enabled = process.env.OSA_LIVE_WORKER_TEST === "1";

test("OSA Worker Host live remote -> worker -> Docker smoke", { skip: !enabled }, async () => {
  const token = "ci-worker-token";
  const docker = new DockerWorkspaceProvider({
    image: "osa/workspace-node22:v0.1",
    defaultPorts: [],
  });

  const server = createWorkerServer({ token, provider: docker });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const remote = new RemoteWorkspaceProvider({
      baseUrl,
      token,
      requestTimeoutMs: 60_000,
    });

    const workspace = await remote.create({
      workspaceId: "worker-live-smoke",
      timeoutMs: 60_000,
      cpu: 1,
      memoryMb: 512,
      ports: [],
    });

    const node = await workspace.exec("node", [
      "-e",
      "process.stdout.write('worker-node-ok')",
    ]);
    assert.equal(node.exitCode, 0);
    assert.equal(node.stdout, "worker-node-ok");

    await workspace.writeFile(
      "/workspace/project/worker-smoke.txt",
      "remote-worker-ok"
    );

    const read = await workspace.exec("cat", [
      "/workspace/project/worker-smoke.txt",
    ]);
    assert.equal(read.exitCode, 0);
    assert.equal(read.stdout, "remote-worker-ok");

    await workspace.stop();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
