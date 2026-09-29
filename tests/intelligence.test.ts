import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import test from "node:test";
import { ApiState, createApiServer } from "../apps/api/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import { digest } from "../packages/proof-core/src";
import {
  createBuiltinIntelligence,
  INTELLIGENCE_CATALOG,
  IntelligenceConfigError,
  IntelligenceModuleId,
  IntelligenceRegistry,
  ModuleImplementation,
  ModuleReport,
} from "../packages/intelligence/src";
import { listConfiguredModels } from "../packages/intelligence/src/builtin";

const CLOCK = () => new Date("2026-09-29T10:00:00.000Z");

function passing(id: IntelligenceModuleId): ModuleImplementation {
  const spec = INTELLIGENCE_CATALOG.find((s) => s.id === id)!;
  return { id, version: "test", checks: spec.required_proofs.map((proof_id) => ({ proof_id, run: () => ({ ok: true, detail: "ok" }) })) };
}

function byId(reports: ModuleReport[], id: string): ModuleReport {
  const report = reports.find((r) => r.id === id);
  assert.ok(report, `missing report ${id}`);
  return report;
}

test("catalog: 9 modules, unique ids, known and acyclic dependencies", async () => {
  const ids = INTELLIGENCE_CATALOG.map((s) => s.id);
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, 9);
  for (const spec of INTELLIGENCE_CATALOG) {
    assert.ok(spec.required_proofs.length > 0, `${spec.id} has no required proofs`);
    for (const dep of spec.depends_on) assert.ok(ids.includes(dep), `${spec.id} depends on unknown ${dep}`);
  }
  const all = new IntelligenceRegistry(CLOCK);
  for (const id of ids) all.register(passing(id));
  const reports = await all.reportAll();
  assert.ok(reports.every((r) => r.status === "LIVE"), "catalog must allow every module to become LIVE");
});

test("rule 2: no implementation -> SOON", async () => {
  const reports = await new IntelligenceRegistry(CLOCK).reportAll();
  assert.ok(reports.every((r) => r.status === "SOON" && r.proofs.length === 0 && r.version === null));
});

test("rule 3/5: a failing, missing or throwing proof keeps the module in PREVIEW", async () => {
  const failing = new IntelligenceRegistry(CLOCK);
  failing.register({ ...passing("memory"), checks: passing("memory").checks.map((c, i) => (i === 0 ? { ...c, run: () => ({ ok: false, detail: "nope" }) } : c)) });
  assert.equal(byId(await failing.reportAll(), "memory").status, "PREVIEW");

  const missing = new IntelligenceRegistry(CLOCK);
  missing.register({ ...passing("memory"), checks: passing("memory").checks.slice(1) });
  const m = byId(await missing.reportAll(), "memory");
  assert.equal(m.status, "PREVIEW");
  assert.ok(m.proofs.some((p) => !p.ok && p.detail === "no check provided for this proof"));

  const throwing = new IntelligenceRegistry(CLOCK);
  throwing.register({ ...passing("memory"), checks: passing("memory").checks.map((c, i) => (i === 0 ? { ...c, run: () => { throw new Error("boom"); } } : c)) });
  const t = byId(await throwing.reportAll(), "memory");
  assert.equal(t.status, "PREVIEW");
  assert.match(t.proofs[0].detail, /check threw: boom/);
});

test("rule 3: a check returning a truthy non-true ok does not pass", async () => {
  const registry = new IntelligenceRegistry(CLOCK);
  registry.register({ ...passing("datasets"), checks: passing("datasets").checks.map((c) => ({ ...c, run: () => ({ ok: "yes" as unknown as boolean, detail: "" }) })) });
  assert.equal(byId(await registry.reportAll(), "datasets").status, "PREVIEW");
});

test("rule 4: LIVE needs every dependency LIVE; blocked_by names the blockers", async () => {
  const registry = new IntelligenceRegistry(CLOCK);
  registry.register(passing("context-hub"));
  registry.register(passing("memory"));
  const reports = await registry.reportAll();
  const hub = byId(reports, "context-hub");
  assert.equal(hub.status, "PREVIEW");
  assert.deepEqual(hub.blocked_by, ["knowledge"]);
  registry.register(passing("knowledge"));
  assert.equal(byId(await registry.reportAll(), "context-hub").status, "LIVE");
});

test("rule 1: unknown or duplicate modules are refused", () => {
  const registry = new IntelligenceRegistry(CLOCK);
  assert.throws(() => registry.register({ id: "telepathy" as IntelligenceModuleId, version: "x", checks: [] }), IntelligenceConfigError);
  registry.register(passing("models"));
  assert.throws(() => registry.register(passing("models")), IntelligenceConfigError);
});

test("rule 6: every report is content-addressed", async () => {
  const reports = await createBuiltinIntelligence(CLOCK).reportAll();
  for (const report of reports) {
    const { report_sha256, ...body } = report;
    assert.equal(report_sha256, digest(body));
  }
});

test("built-in: Models, LLM Gateway and Model Mesh LIVE on their proofs, the rest SOON", async () => {
  const reports = await createBuiltinIntelligence(CLOCK).reportAll();
  assert.equal(byId(reports, "models").status, "LIVE");
  const gateway = byId(reports, "llm-gateway");
  assert.equal(gateway.status, "LIVE", JSON.stringify(gateway.proofs));
  assert.ok(gateway.proofs.every((p) => p.ok));
  assert.match(gateway.proofs.find((p) => p.proof_id === "routing.multi_provider")!.detail, /anthropic, openai/);
  assert.deepEqual(gateway.blocked_by, []);
  const mesh = byId(reports, "model-mesh");
  assert.equal(mesh.status, "LIVE", JSON.stringify(mesh.proofs));
  assert.match(mesh.proofs.find((p) => p.proof_id === "mesh.evidence_per_hop")!.detail, /primary:failed -> backup:ok/);
  for (const id of ["memory", "knowledge", "context-hub", "datasets", "experiments", "evaluators"]) {
    assert.equal(byId(reports, id).status, "SOON", id);
  }
});

test("built-in checks never read the process environment", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.OSA_MODEL; delete process.env.OSA_PROVIDER; delete process.env.ANTHROPIC_API_KEY;
    assert.equal(byId(await createBuiltinIntelligence(CLOCK).reportAll(), "models").status, "LIVE");
  } finally {
    process.env = saved;
  }
  assert.deepEqual(listConfiguredModels({ OSA_PROVIDER: "anthropic", OSA_MODEL: "m", ANTHROPIC_API_KEY: "k" }), [{ provider: "anthropic", model: "m" }]);
});

test("HTTP: GET /intelligence and /intelligence/:id serve computed reports", async () => {
  const server = createApiServer(new ExecutorRegistry(), new ApiState(createBuiltinIntelligence(CLOCK)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    let res = await fetch(`${base}/intelligence`);
    assert.equal(res.status, 200);
    const all = (await res.json()) as ModuleReport[];
    assert.equal(all.length, 9);
    assert.equal(byId(all, "llm-gateway").status, "LIVE");

    res = await fetch(`${base}/intelligence/models`);
    assert.equal(res.status, 200);
    const models = (await res.json()) as ModuleReport;
    assert.equal(models.status, "LIVE");
    const { report_sha256, ...body } = models;
    assert.equal(report_sha256, digest(body));

    res = await fetch(`${base}/intelligence/telepathy`);
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
