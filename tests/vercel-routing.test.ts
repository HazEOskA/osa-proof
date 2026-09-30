import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { vercelApiPath } from "../apps/api/src/vercel";

test("rewritten Vercel requests map back to the API path, multi-segment and with query", () => {
  assert.equal(vercelApiPath("/api/osa?__osa_path=layers"), "/layers");
  assert.equal(vercelApiPath("/api/osa?__osa_path=runs/run_1/proof"), "/runs/run_1/proof");
  assert.equal(vercelApiPath("/api/osa?__osa_path=intelligence/llm-gateway"), "/intelligence/llm-gateway");
  assert.equal(vercelApiPath("/api/osa?__osa_path=teams/team_dev&version=1"), "/teams/team_dev?version=1");
  assert.equal(vercelApiPath("/api/osa?__osa_path=datasets/notes/verify&as_of=prod"), "/datasets/notes/verify?as_of=prod");
  assert.equal(vercelApiPath("/api/osa?__osa_path=layers/"), "/layers", "empty :path* from a bare /layers");
  assert.equal(vercelApiPath("/api/osa?__osa_path=missions/notes%40v1%3Aa/run"), "/missions/notes%40v1%3Aa/run", "ids stay encoded");
  assert.equal(vercelApiPath("/api/osa?__osa_path="), "/");
});

test("unrewritten URLs still work: /api prefix is stripped, other paths pass through", () => {
  assert.equal(vercelApiPath("/api/layers"), "/layers");
  assert.equal(vercelApiPath("/api/runs/x/events?x=1"), "/runs/x/events?x=1");
  assert.equal(vercelApiPath("/api"), "/");
  assert.equal(vercelApiPath(undefined), "/");
});

test("vercel.json sends every API path to the one function, so all routes share one process state", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: Array<{ source: string; destination: string }> };
  assert.ok(existsSync("api/osa.ts"));
  assert.ok(!existsSync("api/[...path].ts"), "a second function would split in-memory state");
  assert.equal(vercel.rewrites[0].source, "/api/:path*");
  for (const rewrite of vercel.rewrites) assert.match(rewrite.destination, /^\/api\/osa\?__osa_path=/, rewrite.source);
  for (const route of ["layers", "teams", "missions", "runs", "intelligence", "datasets", "evaluators", "build", "auth", "session"]) {
    assert.ok(vercel.rewrites.some((r) => r.source === `/${route}/:path*`), route);
  }
});
