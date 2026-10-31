import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

// Use the root script: TypeScript tests compile under dist/tests while the
// dashboard builder stays an executable CommonJS script under scripts/.
const { spawnOptions, run } = require(join(process.cwd(), "scripts", "build-dashboard.cjs")) as {
  spawnOptions: (command: string, cwd: string, platform?: string) => {shell: boolean; cwd: string};
  run: (command: string, args: string[], cwd: string) => void;
};

test("dashboard builder: npm.cmd uses shell only on Windows", () => {
  const cwd = process.cwd();
  assert.equal(spawnOptions("npm.cmd", cwd, "win32").shell, true);
  assert.equal(spawnOptions("C:\\Program Files\\nodejs\\npm.cmd", cwd, "win32").shell, true);
  assert.equal(spawnOptions("npm.bat", cwd, "win32").shell, true);
  assert.equal(spawnOptions("node.exe", cwd, "win32").shell, false);
  assert.equal(spawnOptions("npm", cwd, "linux").shell, false);
  assert.equal(spawnOptions("npm.cmd", cwd, "linux").shell, false);
  assert.equal(spawnOptions("npm.cmd", cwd, "darwin").shell, false);
  assert.equal(spawnOptions("npm.cmd", cwd, "win32").cwd, cwd);
});

test("dashboard builder: direct native child process exits and errors propagate", () => {
  const cwd = process.cwd();
  assert.doesNotThrow(() => run(process.execPath, ["-e", "process.exit(0)"], cwd));
  assert.throws(() => run(process.execPath, ["-e", "process.exit(9)"], cwd), /failed with exit code 9/);
});

test("dashboard builder: real npm.cmd runs on Windows Node 24 without EINVAL", {
  skip: process.platform !== "win32",
}, () => {
  // This invokes the actual npm.cmd through cmd.exe, but does not install or
  // mutate anything. It catches the original spawnSync npm.cmd EINVAL bug.
  assert.doesNotThrow(() => run("npm.cmd", ["--version"], process.cwd()));
});
