import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { runHermesP1, verifyHermesP1Bundle } from "../packages/supervisor-adapter/src";

const scope = {
  workspace_root: resolve(process.cwd()),
  organization_id: "osa-p1-test",
  project_id: "osa-proof",
  allowed_files: ["package.json"],
};

test("P1 actual repo: two scoped Fleet leases, two executors, one bound execution_id and verified receipts", async () => {
  const before = await readFile(resolve(process.cwd(), "package.json"));
  const bundle = await runHermesP1({ mission_id: "hermes-p1-repo-real", relative_file: "package.json" }, scope);
  const after = await readFile(resolve(process.cwd(), "package.json"));

  assert.deepEqual(after, before, "READ-ONLY execution must not change the source file");
  assert.equal(bundle.record.state, "COMPLETED");
  assert.equal(bundle.record.run?.verdict, "VERIFIED");
  assert.equal(bundle.record.run?.proof.verdict, "VERIFIED");
  assert.equal(bundle.record.mission_receipt?.schema, "osa.mission_receipt.v1");
  assert.equal(bundle.record.run?.proof.schema, "osa.proof_receipt.v2");
  assert.equal(bundle.record.task_graph.nodes.length, 2);
  assert.deepEqual(bundle.record.task_graph.nodes.map((task) => task.state), ["COMPLETED", "COMPLETED"]);

  const run = bundle.record.run!;
  assert.equal(run.events.filter((event) => event.type === "AGENT_COMPLETED").length, 2);
  assert.equal(run.events.filter((event) => event.type === "HANDOFF_CREATED").length, 1);
  assert.deepEqual(new Set(run.evidence.map((e) => e.agent_id)), new Set(["inspect", "verify"]));
  assert.equal(run.evidence.length, 2);
  assert.deepEqual(new Set(bundle.assignments.map((job) => job.worker_id)),
    new Set(["osa-p1-inspector", "osa-p1-verifier"]));
  assert.ok(bundle.assignments.every((job) => job.execution_id === run.execution_id));
  assert.ok(run.evidence.every((e) => e.execution_id === run.execution_id));
  assert.deepEqual(verifyHermesP1Bundle(bundle), { ok: true, errors: [] });
});

test("P1 fail-closed: tampered proof root, observation, evidence or output is rejected", async () => {
  const bundle = await runHermesP1({ mission_id: "hermes-p1-adversarial", relative_file: "package.json" }, scope);
  for (const name of ["root", "observation", "evidence", "output"] as const) {
    const copy = structuredClone(bundle);
    const run = copy.record.run!;
    switch (name) {
      case "root": run.proof.evidence_root = "0".repeat(64); break;
      case "observation": run.observations[0].reason = "FORGED"; break;
      case "evidence": run.evidence[0].data.status = "FORGED"; break;
      case "output": run.final_output = { status: "FORGED" }; break;
    }
    assert.equal(verifyHermesP1Bundle(copy).ok, false, name + " must be rejected");
  }
});

test("P1 fail-closed: path traversal, unlisted file, missing file and malformed scope", async () => {
  const mission_id = "hermes-p1-denied";
  await assert.rejects(runHermesP1({ mission_id, relative_file: "../../etc/passwd" }, scope), /P1_FILE_NOT_ALLOWED/);
  await assert.rejects(runHermesP1({ mission_id, relative_file: "README.md" }, scope), /P1_FILE_NOT_ALLOWED/);
  await assert.rejects(runHermesP1({ mission_id, relative_file: "missing-file" },
    { ...scope, allowed_files: ["missing-file"] }), /ENOENT/);
  await assert.rejects(runHermesP1({ mission_id, relative_file: "package.json" },
    { ...scope, organization_id: "" }), /P1_INVALID_SCOPE/);
});
