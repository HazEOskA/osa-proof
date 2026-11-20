import assert from "node:assert/strict";
import test from "node:test";
import { codingHosts } from "../apps/api/src/coding-hosts";

test("public coding hosts never reveal whether provider keys are configured", () => {
  const hosts = codingHosts();
  const body = JSON.stringify(hosts);
  assert.deepEqual(hosts.map((host) => [host.id, host.state]), [
    ["cursor", "NOT_CONNECTED"],
    ["claude_code", "NOT_CONNECTED"],
    ["chatgpt", "NOT_CONNECTED"],
  ]);
  assert.equal(body.includes("KEY_PRESENT"), false);
  assert.equal(/klucz|key|secret/i.test(body), false);
  assert.ok(hosts.every((host) => host.detail === "Brak sesji agenta w tym procesie."));
});
