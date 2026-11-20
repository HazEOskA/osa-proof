import assert from "node:assert/strict";
import test from "node:test";
import { codingHosts } from "../apps/api/src/coding-hosts";

test("coding hosts stay disconnected without a key and never report a session", () => {
  const hosts = codingHosts({});
  assert.deepEqual(hosts.map((host) => host.id), ["cursor", "claude_code", "chatgpt"]);
  assert.ok(hosts.every((host) => host.state === "NOT_CONNECTED"));
  assert.ok(hosts.every((host) => !/połączon/i.test(host.detail) || /brak/i.test(host.detail)));
});

test("a present key is not a Cursor, Claude Code, or ChatGPT session", () => {
  const hosts = codingHosts({
    CURSOR_API_KEY: "cursor-secret",
    ANTHROPIC_API_KEY: "claude-secret",
    OPENAI_API_KEY: " ",
  });
  assert.equal(hosts.find((host) => host.id === "cursor")?.state, "KEY_PRESENT");
  assert.equal(hosts.find((host) => host.id === "claude_code")?.state, "KEY_PRESENT");
  assert.equal(hosts.find((host) => host.id === "chatgpt")?.state, "NOT_CONNECTED");
  assert.match(hosts[0].detail, /Nie ma sesji agenta/);
});
