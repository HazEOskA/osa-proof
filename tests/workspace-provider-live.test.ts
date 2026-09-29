import assert from "node:assert/strict";
import test from "node:test";
import { DockerWorkspaceProvider } from "../packages/workspace-runtime/src/docker";

const enabled = process.env.OSA_LIVE_DOCKER_TEST === "1";

test("Docker Workspace Provider live smoke", { skip: !enabled }, async () => {
  const provider = new DockerWorkspaceProvider({
    image: "osa/workspace-node22:v0.1",
    defaultPorts: [],
  });

  const workspace = await provider.create({
    workspaceId: "live-smoke",
    timeoutMs: 60_000,
    cpu: 1,
    memoryMb: 512,
  });

  try {
    const node = await workspace.exec("node", ["-e", "process.stdout.write('node-ok')"]);
    assert.equal(node.exitCode, 0);
    assert.equal(node.stdout, "node-ok");

    await workspace.writeFile("/workspace/project/smoke.txt", "workspace-ok");
    const read = await workspace.exec("cat", ["/workspace/project/smoke.txt"]);
    assert.equal(read.exitCode, 0);
    assert.equal(read.stdout, "workspace-ok");
  } finally {
    await workspace.stop();
  }
});
