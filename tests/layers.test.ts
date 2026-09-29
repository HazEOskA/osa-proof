import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { createApiServer } from "../apps/api/src";
import { enterLayer, listLayerProfiles } from "../packages/access-control/src";
import { createLocalDevIdentity } from "../packages/identity/src";
import { ExecutorRegistry } from "../packages/runtime/src";

const regulated = ["bank", "financial", "cybersecurity", "army"] as const;

test("layer catalog exposes the six locked product entries", () => {
  const profiles = listLayerProfiles();
  assert.deepEqual(
    profiles.map((profile) => profile.layer_id),
    ["school", "dev", "bank", "financial", "cybersecurity", "army"]
  );
  assert.equal(new Set(profiles.map((profile) => profile.route)).size, 6);
  assert.ok(profiles.every((profile) => profile.proof_required));
});

test("School is public, Dev requires identity, regulated layers fail closed", () => {
  assert.equal(enterLayer("school")?.decision, "ALLOWED");
  const devWithoutIdentity = enterLayer("dev");
  assert.equal(devWithoutIdentity?.decision, "GATED");
  assert.equal(devWithoutIdentity?.gate?.code, "AUTHENTICATED_SESSION_REQUIRED");
  const identity = createLocalDevIdentity({ display_name: "Layer Test" });
  assert.equal(enterLayer("dev", identity)?.decision, "ALLOWED");

  for (const layerId of regulated) {
    const result = enterLayer(layerId);
    assert.equal(result?.decision, "GATED");
    assert.equal(result?.gate?.code, "VERIFIED_ORGANIZATION_REQUIRED");
    assert.equal(result?.gate?.authoritative, true);
    assert.ok(result?.gate?.requirements.includes("organization_verification"));
    assert.ok(result?.gate?.requirements.includes("administrative_approval"));
  }

  assert.equal(enterLayer("unknown"), undefined);
});

test("HTTP layer entry returns backend-authoritative navigation decisions", async () => {
  const server = createApiServer(new ExecutorRegistry());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    let response = await fetch(`${base}/layers`);
    assert.equal(response.status, 200);
    const catalog = (await response.json()) as Array<{ layer_id: string }>;
    assert.equal(catalog.length, 6);

    response = await fetch(`${base}/layers/school/enter`, { method: "POST" });
    assert.equal(response.status, 200);
    const schoolEntry = (await response.json()) as {
      decision: string;
      layer: { route: string };
    };
    assert.equal(schoolEntry.decision, "ALLOWED");
    assert.equal(schoolEntry.layer.route, "/school/");

    response = await fetch(`${base}/layers/dev/enter`, { method: "POST" });
    assert.equal(response.status, 401);
    const devBlocked = (await response.json()) as { gate?: { code?: string } };
    assert.equal(devBlocked.gate?.code, "AUTHENTICATED_SESSION_REQUIRED");

    response = await fetch(`${base}/auth/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ display_name: "HTTP DEV", email: "http-dev@example.com" }),
    });
    assert.equal(response.status, 201);
    const login = (await response.json()) as { session: { token: string } };

    response = await fetch(`${base}/layers/dev/enter`, {
      method: "POST",
      headers: { authorization: `Bearer ${login.session.token}` },
    });
    assert.equal(response.status, 200);
    const devEntry = (await response.json()) as { decision: string; layer: { route: string } };
    assert.equal(devEntry.decision, "ALLOWED");
    assert.equal(devEntry.layer.route, "/dev/");

    response = await fetch(`${base}/layers/bank/enter`, { method: "POST" });
    assert.equal(response.status, 200);
    const bankEntry = (await response.json()) as {
      decision: string;
      layer: { route: string };
      gate?: { authoritative: boolean };
    };
    assert.equal(bankEntry.decision, "GATED");
    assert.equal(bankEntry.layer.route, "/bank/");
    assert.equal(bankEntry.gate?.authoritative, true);

    response = await fetch(`${base}/layers/nope/enter`, { method: "POST" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
