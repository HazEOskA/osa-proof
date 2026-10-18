import assert from "node:assert/strict";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { PreviewOperator } from "../apps/api/src/preview-operator";
import { isNeurosaProtectedPreview } from "../api/osa";
import { ExecutorRegistry } from "../packages/runtime/src";
import { BrainControlPlane } from "../packages/brain/src";
import { NeurosaMemoryAdapter } from "../packages/adapters/src";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

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
test("private Preview memory is limited to the protected PR branch alias", () => {
  const hostname = "osa-proof-git-codex-neurosa-chat-memory-osabarca-1680s-projects.vercel.app";
  assert.equal(isNeurosaProtectedPreview(hostname, env), true);
  for (const hostnameInvalid of ["agentworlds.dev", "osa-proof-three.vercel.app",
    "osa-proof-qtyczc1ue-osabarca-1680s-projects.vercel.app", "evil.example", ""]) {
    assert.equal(isNeurosaProtectedPreview(hostnameInvalid, env), false);
  }
  for (const changes of [{ VERCEL_ENV: "production" }, { VERCEL: "0" },
    { OSA_PREVIEW_SINGLE_OPERATOR: undefined }]) {
    assert.equal(isNeurosaProtectedPreview(hostname, { ...env, ...changes }), false);
  }
  assert.equal(isNeurosaProtectedPreview(hostname, env, "agentworlds.dev"), false);
  assert.equal(isNeurosaProtectedPreview(hostname, env, hostname), true);
  assert.ok(PreviewOperator.fromEnvironment({ ...env, VERCEL_GIT_REPO_OWNER: undefined,
    VERCEL_GIT_REPO_SLUG: undefined }), "Vercel may omit optional git metadata at runtime");
  assert.throws(() => PreviewOperator.fromEnvironment({ ...env, VERCEL_GIT_REPO_OWNER: "other" }));
});

test("preview operator uses NeurOSA without OAuth, forbids cross-origin writes", async () => {
  const operator = PreviewOperator.fromEnvironment(env)!;
  const memory = new NeurosaMemoryAdapter({ baseUrl: "https://memory.example", token: "test-token-".repeat(4),
    brainId: "OsaBrain", organizationId: "org_dev_local", projectId: "osa-proof",
    fetch: async () => Response.json({ brainId: "OsaBrain", ledgerValid: true }) });
  const state = new ApiState(undefined, undefined, undefined, "open", undefined,
    new BrainControlPlane(undefined, memory), undefined, operator);
  const server = createApiServer(new ExecutorRegistry(), state);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    assert.equal((await fetch(base + "/auth/github/status")).status, 404);
    assert.equal((await fetch(base + "/memory/status").then(r => r.json()) as {state:string}).state, "AVAILABLE");
    assert.equal((await fetch(base + "/nvidia/status")).status, 200);
    assert.equal((await fetch(base + "/layers")).status, 200);
    assert.equal((await fetch(base + "/intelligence")).status, 200);
    const permissions = await fetch(base + "/permissions");
    assert.equal(permissions.status, 200);
    assert.equal((await permissions.json() as {identity:{identity_id:string}}).identity.identity_id, "idn_vercel_protected_preview");
    // Old/foreign bearer tokens cannot reintroduce a login requirement or
    // replace the protected Preview operator with another project identity.
    const foreign = state.sessions.create({identity_id:"foreign",provider:"github",
      subject:"github:999",display_name:"Foreign",verified:true,roles:[],
      organization_id:"foreign",project_ids:["foreign"]});
    for (const token of ["stale-token", foreign.token]) {
      const headers = {authorization: "Bearer " + token};
      const granted = await fetch(base + "/permissions", {headers});
      assert.equal(granted.status, 200);
      assert.equal((await granted.json() as {identity:{identity_id:string}}).identity.identity_id,
        "idn_vercel_protected_preview");
      assert.equal((await fetch(base + "/intelligence", {headers})).status, 200);
      assert.equal((await fetch(base + "/nvidia/status", {headers})).status, 200);
      assert.equal((await fetch(base + "/memory/status", {headers}).then(r=>r.json()) as {state:string}).state, "AVAILABLE");
    }
    for (const headers of [{ origin: "https://evil.example" },
      { origin: "https://preview.example", host: "preview.example", "sec-fetch-site": "cross-site" },
      { host: "preview.example" }]) {
      const response = await fetch(base + "/unified/execute", { method: "POST", headers: headers as Record<string, string>, body: "{}" });
      assert.equal(response.status, 403);
      assert.equal((await response.json() as {code:string}).code, "PREVIEW_ORIGIN_REJECTED");
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});


test("protected Preview runs a native mission and verifies proof without application login", async () => {
  const operator = PreviewOperator.fromEnvironment(env)!;
  const state = new ApiState(undefined, undefined, undefined, "open", undefined, undefined, undefined, operator);
  const server = createApiServer(new ExecutorRegistry(), state);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const headers = {"content-type":"application/json",
      origin: "https://" + new URL(base).host, "sec-fetch-site":"same-origin"};
    const entered = await fetch(base + "/layers/dev/enter", {method:"POST",headers});
    assert.equal(entered.status, 200, "DEV entry has no application login on protected Preview");
    const execution = await fetch(base + "/unified/execute", {
      method:"POST",headers,
      body:JSON.stringify({message:"oblicz sha256 tekstu: preview-flow",
        execution_id:"exec_" + randomUUID()})
    });
    assert.equal(execution.status, 200, "native mission must execute without a bearer token");
    const result = await execution.json() as {status:string,integrity:{ok:boolean},
      team:unknown,mission:unknown,run:unknown};
    assert.equal(result.status, "EXECUTED");
    assert.equal(result.integrity.ok, true);
    const verification = await fetch(base + "/unified/verify", {
      method:"POST",headers,
      body:JSON.stringify({team:result.team,mission:result.mission,run:result.run})
    });
    assert.equal(verification.status, 200);
    assert.equal((await verification.json() as {ok:boolean}).ok, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
