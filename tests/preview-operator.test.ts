import assert from "node:assert/strict";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { PreviewOperator } from "../apps/api/src/preview-operator";
import { ExecutorRegistry } from "../packages/runtime/src";
import { BrainControlPlane } from "../packages/brain/src";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";
import type { AddressInfo } from "node:net";

const env = { OSA_PREVIEW_SINGLE_OPERATOR: "enabled", VERCEL: "1", VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "codex/neurosa-chat-memory", VERCEL_GIT_REPO_OWNER: "HazEOskA",
  VERCEL_GIT_REPO_SLUG: "osa-proof", OSA_NEUROSA_ORGANIZATION_ID: "org_dev_local",
  OSA_NEUROSA_PROJECT_ID: "osa-proof" };

test("single operator is restricted to protected PR Preview and server scope", () => {
  const operator = PreviewOperator.fromEnvironment(env)!;
  assert.equal(operator.session.identity.provider, "vercel-preview");
  assert.deepEqual(operator.session.identity.project_ids, ["osa-proof"]);
  assert.equal(PreviewOperator.fromEnvironment({}), undefined);
  for (const change of [{ VERCEL_ENV: "production" }, { VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL: "0" }, { OSA_PREVIEW_SINGLE_OPERATOR: "disabled" },
    { VERCEL_GIT_REPO_OWNER: "other" }, { OSA_NEUROSA_PROJECT_ID: "" }])
    assert.throws(() => PreviewOperator.fromEnvironment({ ...env, ...change }));
});
test("preview operator uses NeurOSA without OAuth, forbids cross-origin writes", async () => {
  const operator = PreviewOperator.fromEnvironment(env)!;
  const memory = new NeurosaMemoryAdapter({ baseUrl: "https://memory.example", token: "test-token-".repeat(4),
    brainId: "OsaBrain", organizationId: "org_dev_local", projectId: "osa-proof",
    fetch: async () => Response.json({ brainId: "OsaBrain", ledgerValid: true }) });
  const state = new ApiState(undefined, undefined, undefined, "open", undefined,
    new BrainControlPlane(undefined, memory), undefined, undefined, operator);
  const server = createApiServer(new ExecutorRegistry(), state);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    assert.deepEqual(await (await fetch(base + "/auth/github/status")).json(),
      { enabled: true, signed_in: true, display_name: "Operator Preview", mode: "preview-operator" });
    assert.equal((await fetch(base + "/memory/status").then(r => r.json()) as {state:string}).state, "AVAILABLE");
    assert.equal((await fetch(base + "/nvidia/status")).status, 200);
    for (const headers of [{ origin: "https://evil.example" },
      { origin: "https://preview.example", host: "preview.example", "sec-fetch-site": "cross-site" },
      { host: "preview.example" }]) {
      const response = await fetch(base + "/unified/execute", { method: "POST", headers: headers as Record<string, string>, body: "{}" });
      assert.equal(response.status, 403);
      assert.equal((await response.json() as {code:string}).code, "PREVIEW_ORIGIN_REJECTED");
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
