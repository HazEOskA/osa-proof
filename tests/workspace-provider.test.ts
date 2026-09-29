import assert from "node:assert/strict";
import test from "node:test";
import {
  DockerWorkspaceProvider,
  __dockerWorkspaceInternals,
  type DockerCli,
  type DockerCliRunOptions,
} from "../packages/workspace-runtime/src/docker";
import type { WorkspaceCommandResult } from "../packages/workspace-runtime/src";

interface Call {
  args: string[];
  options?: DockerCliRunOptions;
}

class FakeDockerCli implements DockerCli {
  readonly calls: Call[] = [];

  async run(
    args: readonly string[],
    options?: DockerCliRunOptions
  ): Promise<WorkspaceCommandResult> {
    this.calls.push({ args: [...args], options });

    if (args[0] === "run") {
      return { exitCode: 0, stdout: "container-123\n", stderr: "" };
    }

    if (args[0] === "exec" && args.includes("printf-env")) {
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    }

    if (args[0] === "port") {
      return { exitCode: 0, stdout: "127.0.0.1:49123\n", stderr: "" };
    }

    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

test("Docker Workspace Provider creates an isolated OSA container with bounded resources", async () => {
  const cli = new FakeDockerCli();
  const provider = new DockerWorkspaceProvider({
    cli,
    image: "osa/workspace-node22:v0.1",
    network: "bridge",
    defaultPorts: [3000],
  });

  const workspace = await provider.create({
    workspaceId: "Mission BUILDER/01",
    timeoutMs: 60_000,
    cpu: 2,
    memoryMb: 3072,
  });

  assert.equal(provider.id, "docker");
  assert.equal(workspace.id, "container-123");
  assert.equal(workspace.rootDir, "/workspace");

  const create = cli.calls[0];
  assert.equal(create.args[0], "run");
  assert.ok(create.args.includes("--cpus"));
  assert.ok(create.args.includes("2"));
  assert.ok(create.args.includes("--memory"));
  assert.ok(create.args.includes("3072m"));
  assert.ok(create.args.includes("--network"));
  assert.ok(create.args.includes("bridge"));
  assert.ok(create.args.includes("osa.managed=true"));
  assert.ok(create.args.includes("osa.workspace-node22:v0.1") === false);
  assert.ok(create.args.includes("osa/workspace-node22:v0.1"));
  assert.ok(create.args.includes("127.0.0.1::3000"));
  assert.ok(create.args.includes("sleep infinity"));

  await workspace.stop();
});

test("Docker Workspace Provider exec keeps env on docker exec rather than image config", async () => {
  const cli = new FakeDockerCli();
  const provider = new DockerWorkspaceProvider({ cli, defaultPorts: [] });
  const workspace = await provider.create({
    workspaceId: "env-test",
    timeoutMs: 60_000,
  });

  const result = await workspace.exec("printf-env", ["hello"], {
    cwd: "/workspace/project",
    env: {
      SECRET_VALUE: "ephemeral-secret",
      CI: "true",
    },
    timeoutMs: 10_000,
  });

  assert.equal(result.exitCode, 0);
  const execCall = cli.calls.find(
    (call) => call.args[0] === "exec" && call.args.includes("printf-env")
  );
  assert.ok(execCall);
  assert.ok(execCall.args.includes("-w"));
  assert.ok(execCall.args.includes("/workspace/project"));
  assert.ok(execCall.args.includes("SECRET_VALUE=ephemeral-secret"));
  assert.ok(execCall.args.includes("CI=true"));

  const createCall = cli.calls[0];
  assert.ok(!createCall.args.some((arg) => arg.includes("ephemeral-secret")));

  await workspace.stop();
});

test("Docker Workspace Provider writeFile streams content through stdin", async () => {
  const cli = new FakeDockerCli();
  const provider = new DockerWorkspaceProvider({ cli, defaultPorts: [] });
  const workspace = await provider.create({
    workspaceId: "write-test",
    timeoutMs: 60_000,
  });

  await workspace.writeFile(
    "/workspace/project/.config/test.txt",
    "native-builder"
  );

  const writeCall = cli.calls.find(
    (call) => call.args[0] === "exec" && call.args[1] === "-i"
  );
  assert.ok(writeCall);
  assert.equal(writeCall.options?.stdin, "native-builder");
  assert.ok(writeCall.args.includes("/workspace/project/.config/test.txt"));

  await workspace.stop();
});

test("Docker Workspace Provider resolves published port and stop is idempotent", async () => {
  const cli = new FakeDockerCli();
  const provider = new DockerWorkspaceProvider({ cli, defaultPorts: [5173] });
  const workspace = await provider.create({
    workspaceId: "port-test",
    timeoutMs: 60_000,
  });

  assert.equal(await workspace.exposePort?.(5173), "http://127.0.0.1:49123");

  await workspace.stop();
  await workspace.stop();

  const removeCalls = cli.calls.filter(
    (call) => call.args[0] === "rm" && call.args[1] === "-f"
  );
  assert.equal(removeCalls.length, 1);
});

test("Docker Workspace Provider naming and port parsing are deterministic", () => {
  assert.equal(
    __dockerWorkspaceInternals.sanitizeContainerName(" /OSA Mission #42/ "),
    "osa-mission-42"
  );
  assert.equal(
    __dockerWorkspaceInternals.parsePublishedPort("127.0.0.1:45001\n"),
    "http://127.0.0.1:45001"
  );
  assert.equal(
    __dockerWorkspaceInternals.parsePublishedPort("[::1]:45002\n"),
    "http://[::1]:45002"
  );
});
