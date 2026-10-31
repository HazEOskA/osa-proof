import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

test("HTTP docs check accepts Windows CRLF, detects real drift, and sync preserves line endings", async () => {
  const source = process.cwd();
  const temp = await mkdtemp(join(tmpdir(), "osa-http-docs-crlf-"));
  const script = join(temp, "scripts", "sync-api-reference.cjs");
  const control = join(temp, "packages", "control", "src", "index.ts");
  const html = join(temp, "apps", "web", "docs", "index.html");
  try {
    await Promise.all([
      mkdir(join(temp, "scripts"), {recursive:true}),
      mkdir(join(temp, "packages", "control", "src"), {recursive:true}),
      mkdir(join(temp, "apps", "web", "docs"), {recursive:true}),
    ]);
    await writeFile(script, await readFile(join(source,"scripts","sync-api-reference.cjs")));
    await writeFile(control, await readFile(join(source,"packages","control","src","index.ts")));

    const original = (await readFile(join(source,"apps","web","docs","index.html"), "utf8")).replace(/\r\n/g,"\n");
    const crlf = original.replace(/\n/g,"\r\n");
    await writeFile(html,crlf);
    const check = () => exec(process.execPath,[script,"--check"],{cwd:temp});
    const sync = () => exec(process.execPath,[script,"--write"],{cwd:temp});

    const before=await check();
    assert.match(before.stdout,/HTTP API docs synchronized:/);
    assert.equal(await readFile(html,"utf8"),crlf,"checking must not rewrite a Windows checkout");

    const marker="Server-bound artifact generation availability and model; no provider call.";
    assert.ok(crlf.includes(marker),"fixture includes a generated API description");
    await writeFile(html,crlf.replace(marker,"INTENTIONAL DRIFT"));
    await assert.rejects(check(), (error: unknown) => {
      const failure = error as Error & {stderr?:string;code?:number};
      return failure.code===1 && /HTTP docs drift/.test(failure.stderr??"");
    });
    await sync();
    const after=await check();
    assert.match(after.stdout,/HTTP API docs synchronized:/);
    assert.equal(await readFile(html,"utf8"),crlf,"sync restores content without newline drift");
  } finally {
    await rm(temp,{recursive:true,force:true});
  }
});
