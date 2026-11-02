// Real local mission through the existing OSA Runtime/Fleet, not a mocked receipt.
// Runs only against the explicitly allowlisted repository package.json.
const { mkdir, writeFile } = require("node:fs/promises");
const { resolve, join } = require("node:path");
const { runHermesP1, verifyHermesP1Bundle } = require("../dist/packages/supervisor-adapter/src");
(async () => {
  const bundle = await runHermesP1(
    { mission_id: "hermes-fleet-p1-ci", relative_file: "package.json" },
    {
      workspace_root: resolve(process.cwd()),
      organization_id: "osa-p1-ci", project_id: "osa-proof",
      allowed_files: ["package.json"],
    }
  );
  const check = verifyHermesP1Bundle(bundle);
  if (!check.ok) throw new Error("P1_PROOF_REJECTED: " + check.errors.join(","));
  const dir = join("artifacts", "hermes-fleet-p1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "proof-bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
  await writeFile(join(dir, "result.json"), JSON.stringify({
    schema: bundle.schema, status: "PASS",
    mission_id: bundle.record.mission.mission_id,
    run_id: bundle.record.run.run_id,
    execution_id: bundle.record.run.execution_id,
    verdict: bundle.record.run.verdict,
    proof_sha256: bundle.record.run.proof.receipt_sha256,
    mission_receipt_sha256: bundle.record.mission_receipt.receipt_sha256,
    worker_count: bundle.assignments.length,
    verification: check,
    limitation: "local single-process Fleet; Hermes host transport not verified; no external attestation"
  }, null, 2) + "\n");
  console.log("P1 real source / scoped workers / receipt VERIFIED", bundle.record.run.execution_id);
})().catch((err) => { console.error(err); process.exitCode = 1; });
