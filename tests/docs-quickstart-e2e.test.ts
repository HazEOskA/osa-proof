import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { createDevFixtureRegistry } from "../apps/api/src/server";

// Read the exact public Docs payloads. No duplicate hand-maintained Team Graph or Mission fixture.
const html = readFileSync(resolve(process.cwd(), "apps/web/docs/index.html"), "utf8");

function stepCode(heading: string): string {
  const section = html.match(/<section id="first-mission"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, "Docs must contain the first-mission section");
  const marker = '<h3 class="h">' + heading + "</h3>";
  const slices = section.split(marker);
  assert.equal(slices.length, 2, "Missing or duplicated Docs step: " + heading);
  const pre = slices[1].match(/<pre>([\s\S]*?)<\/pre>/);
  assert.ok(pre, "Missing copyable code block for: " + heading);
  return pre[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function payload(heading: string): Record<string, unknown> {
  const match = stepCode(heading).match(/-d\s+'(\{[\s\S]*?\})'/);
  assert.ok(match, "Copyable Docs step must contain a JSON curl -d payload: " + heading);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

async function withFixtureServer(run: (base: string) => Promise<void>): Promise<void> {
  const server = createApiServer(
    createDevFixtureRegistry(),
    new ApiState(undefined, undefined, undefined, "session"),
    { mode: "fixture" }
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    await run(base);
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
}

async function login(base: string): Promise<{ token: string; organizationId: string }> {
  assert.match(stepCode("0. Log in (DEV)"), /localhost:3000\/auth\/dev-login/);
  const response = await fetch(base + "/auth/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload("0. Log in (DEV)")),
  });
  assert.equal(response.status, 201, "Documented DEV login must succeed");
  const data = await response.json() as {
    identity: { organization_id: string };
    session: { token: string };
  };
  assert.ok(data.session.token);
  assert.equal(data.identity.organization_id, "org_dev_local");
  return { token: data.session.token, organizationId: data.identity.organization_id };
}

function post(base: string, endpoint: string, body: unknown, token: string): Promise<Response> {
  return fetch(base + endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
}

test("Docs Quickstart — exact copied payloads: dev-login → team → mission → run → VERIFIED receipt", async () => {
  await withFixtureServer(async (base) => {
    const auth = await login(base);
    const team = payload("1. Register the team");
    const mission = payload("2. Submit the mission");
    assert.match(stepCode("1. Register the team"), /localhost:3000\/teams\b/);
    assert.match(stepCode("2. Submit the mission"), /localhost:3000\/missions\b/);
    assert.match(stepCode("3. Run it and read the proof"), /\/missions\/mission_hello\/run/);
    assert.match(stepCode("3. Run it and read the proof"), /\/runs\/\$RUN\/proof/);
    assert.equal(team.organization_id, auth.organizationId, "Docs team organization must equal authenticated DEV scope");
    assert.equal(mission.organization_id, auth.organizationId, "Docs mission organization must equal authenticated DEV scope");
    assert.equal(mission.team_id, team.team_id);
    assert.equal(mission.team_version, team.version);

    const teamResponse = await post(base, "/teams", team, auth.token);
    assert.equal(teamResponse.status, 201, "Copyable POST /teams must return 201");
    const missionResponse = await post(base, "/missions", mission, auth.token);
    assert.equal(missionResponse.status, 201, "Copyable POST /missions must return 201");
    const runResponse = await fetch(base + "/missions/" + encodeURIComponent(String(mission.mission_id)) + "/run", {
      method: "POST", headers: { authorization: "Bearer " + auth.token },
    });
    assert.equal(runResponse.status, 201);
    const run = await runResponse.json() as { run_id: string; verdict: string };
    assert.equal(run.verdict, "VERIFIED");
    const proofResponse = await fetch(base + "/runs/" + encodeURIComponent(run.run_id) + "/proof", {
      headers: { authorization: "Bearer " + auth.token },
    });
    assert.equal(proofResponse.status, 200);
    const proof = await proofResponse.json() as {
      verdict: string; run_id: string; organization_id: string; mission_id: string;
    };
    assert.equal(proof.verdict, "VERIFIED");
    assert.equal(proof.run_id, run.run_id);
    assert.equal(proof.organization_id, auth.organizationId);
    assert.equal(proof.mission_id, mission.mission_id);

    const intelligenceResponse = await fetch(base + "/intelligence");
    assert.equal(intelligenceResponse.status, 200);
    const modules = await intelligenceResponse.json() as Array<{ id: string; status: string }>;
    assert.equal(modules.find((item) => item.id === "memory")?.status, "SOON");
    const memoryRow = html.match(/<tr><td><code>memory<\/code><\/td>([\s\S]*?)<\/tr>/)?.[0];
    assert.ok(memoryRow, "Docs must include the memory Intelligence row");
    assert.match(memoryRow, /SOON<\/td>/);
    assert.match(memoryRow, /CODE · GATED/);
    assert.match(memoryRow, /\/memory\/status/);
  });
});

test("Docs Quickstart — wrong tenant is rejected as 403 TENANT_SCOPE_DENIED for team and mission", async () => {
  await withFixtureServer(async (base) => {
    const auth = await login(base);
    const team = payload("1. Register the team");
    const mission = payload("2. Submit the mission");
    const wrongOrganization = "org_dev";
    assert.notEqual(wrongOrganization, auth.organizationId);

    for (const [endpoint, original] of [["/teams", team], ["/missions", mission]] as const) {
      const response = await post(base, endpoint, { ...original, organization_id: wrongOrganization }, auth.token);
      assert.equal(response.status, 403, endpoint + " must reject a foreign organization");
      const result = await response.json() as { error: string };
      assert.equal(result.error, "TENANT_SCOPE_DENIED");
    }
  });
});
