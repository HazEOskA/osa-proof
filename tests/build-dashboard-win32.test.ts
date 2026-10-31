import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The dashboard builder is a root-level CommonJS entrypoint, not a compiled
// TypeScript module. Importing it must NOT run npm install or touch dist.
const script = join(process.cwd(), "scripts", "build-dashboard.cjs");
const { resolveNpmCli, run, runNpm } = require(script) as {
  resolveNpmCli: (nodePath?: string, env?: Record<string,string|undefined>) => string;
  run: (command: string, args: string[], cwd: string) => void;
  runNpm: (args: string[], cwd: string) => void;
};

test("dashboard builder: locates npm JS CLI beside Node and ignores invalid overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "osa-npm-cli-"));
  const fakeNode = join(root, "node.exe");
  const cli = join(root, "node_modules", "npm", "bin", "npm-cli.js");
  try {
    mkdirSync(resolve(cli, ".."), {recursive:true});
    writeFileSync(cli, "process.stdout.write('fixture');\n");
    assert.equal(resolveNpmCli(fakeNode, {}), cli);
    assert.equal(resolveNpmCli(fakeNode, {
      npm_execpath:join(root,"node_modules","pnpm","bin","pnpm.cjs"),
    }), cli, "pnpm is not silently substituted for npm");
    assert.equal(resolveNpmCli(fakeNode, {
      npm_execpath:join(root,"not-absolute.txt"),
    }), cli, "invalid npm override does not mask bundled npm CLI");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("dashboard builder: missing npm CLI fails closed without falling back to shell", () => {
  const root = mkdtempSync(join(tmpdir(), "osa-npm-cli-missing-"));
  try {
    assert.throws(()=>resolveNpmCli(join(root,"node.exe"),{npm_execpath: "npm.cmd"}),
      /NPM_CLI_NOT_FOUND/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("dashboard builder: exit codes of native child processes propagate", () => {
  const cwd=process.cwd();
  assert.doesNotThrow(()=>run(process.execPath,["-e","process.exit(0)"],cwd));
  assert.throws(()=>run(process.execPath,["-e","process.exit(9)"],cwd),
    /failed with exit code 9/);
});

test("dashboard builder: real npm CLI uses Node directly with no DEP0190", () => {
  const cli=resolveNpmCli();
  assert.match(cli,/npm-cli\.js$/i);
  // DEP0190 is thrown if shell=true receives arguments. This nested Node
  // invocation proves that npm executes without such a deprecation warning.
  const result=spawnSync(process.execPath,[
    "--throw-deprecation","-e",
    "require(process.argv[1]).runNpm(['--version'],process.cwd())",
    script,
  ],{cwd:process.cwd(),encoding:"utf8",shell:false});
  assert.equal(result.status,0,
    String(result.error??"")+" "+result.stderr+" "+result.stdout);
  assert.doesNotMatch(result.stderr,/DEP0190/);
  assert.match(result.stdout,/\d+\.\d+\.\d+/);
  assert.equal(typeof runNpm,"function");
});
