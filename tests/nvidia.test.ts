import test from "node:test";
import assert from "node:assert/strict";
import { nvidiaComplete, nvidiaStatus, nvidiaRequestConfig, NvidiaError } from "../apps/api/src/nvidia";
const env = { NVIDIA_API_KEY: "test-secret", NVIDIA_MODEL: "configured-model" };
test("NVIDIA: missing configuration and invalid prompt never call provider", async () => {
  const never = (async () => { throw Error("must not call"); }) as typeof fetch;
  await assert.rejects(nvidiaComplete("hello", {}, never), (e: unknown) => e instanceof NvidiaError && e.status === 503);
  for (const prompt of [null, " ", "x".repeat(8001)]) await assert.rejects(nvidiaComplete(prompt, env, never), (e: unknown) => e instanceof NvidiaError && e.status === 400);
  assert.deepEqual(nvidiaStatus(env), { provider: "NVIDIA", configured: true, model: "configured-model" });
});
test("NVIDIA: server authorization, Polish prompt and response metadata", async () => {
  const fake = (async (url, init) => {
    assert.equal(url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal((init?.headers as Record<string,string>).authorization, "Bearer test-secret");
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, "configured-model"); assert.equal(body.stream, false);
    assert.match(body.messages[0].content, /po polsku/); assert.equal(body.messages[1].content, "Cześć");
    return new Response(JSON.stringify({ id: "provider-id", choices: [{ message: { content: "Witaj" }, finish_reason: "stop" }] }));
  }) as typeof fetch;
  const result = await nvidiaComplete(" Cześć ", env, fake);
  assert.equal(result.text, "Witaj"); assert.equal(result.provider_response_id, "provider-id");
  assert.equal(result.status, "PROVIDER_RESPONSE"); assert.ok(result.request_id);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});
test("NVIDIA: provider errors are sanitized and never become success", async () => {
  for (const status of [401,403,429,500]) {
    await assert.rejects(nvidiaComplete("hello", env, (async () => new Response("test-secret", { status })) as typeof fetch), (e: unknown) => e instanceof NvidiaError && e.status === (status === 429 ? 429 : 502) && !e.message.includes("test-secret"));
  }
  for (const body of ["bad JSON", "null", JSON.stringify({choices:[]})]) await assert.rejects(nvidiaComplete("hello", env, (async () => new Response(body)) as typeof fetch), (e: unknown) => e instanceof NvidiaError && e.status === 502);
  await assert.rejects(nvidiaComplete("hello", env, (async () => { throw Error("test-secret"); }) as typeof fetch), (e: unknown) => e instanceof NvidiaError && e.status === 504 && !e.message.includes("test-secret"));
});

test("NVIDIA HTTP: session gate and malformed requests", async () => {
  const { createApiServer, ApiState } = await import("../apps/api/src");
  const { ExecutorRegistry } = await import("../packages/runtime/src");
  for (const mode of ["session", "open"] as const) {
    const server = createApiServer(new ExecutorRegistry(), new ApiState(undefined, undefined, undefined, mode));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/nvidia`;
    try {
      const status = await fetch(`${url}/status`);
      assert.equal(status.status, mode === "session" ? 401 : 200);
      if (mode === "open") {
        assert.ok(!JSON.stringify(await status.json()).includes("NVIDIA_API_KEY"));
        const invalid = await fetch(`${url}/chat`, {method:"POST",body:"invalid"}); assert.equal(invalid.status,400);
        const large = await fetch(`${url}/chat`, {method:"POST",body:"x".repeat(40001)}); assert.equal(large.status,413);
        const wrong = await fetch(`${url}/chat`); assert.equal(wrong.status,404);
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});


test("NVIDIA: per-request key and model never mutate shared configuration", async () => {
  const original = { NVIDIA_API_KEY: "server-secret", NVIDIA_MODEL: "server/model" };
  const config = nvidiaRequestConfig({ apiKey: "personal-test-secret", model: "nvidia/nemotron-3-nano-30b-a3b" }, original);
  assert.deepEqual(original, { NVIDIA_API_KEY: "server-secret", NVIDIA_MODEL: "server/model" });
  await nvidiaComplete("hello", config, (async (_url, init) => {
    assert.equal((init?.headers as Record<string,string>).authorization, "Bearer personal-test-secret");
    assert.equal(JSON.parse(init?.body as string).model, "nvidia/nemotron-3-nano-30b-a3b");
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  }) as typeof fetch);
  for (const options of [{apiKey: "bad\nheader"}, {apiKey: 1}, {model: "https://evil.test"}, {model: null}]) assert.throws(() => nvidiaRequestConfig(options, original), (e: unknown) => e instanceof NvidiaError && e.status === 400);
  assert.equal(nvidiaRequestConfig({}, original).NVIDIA_API_KEY, "server-secret");
});
