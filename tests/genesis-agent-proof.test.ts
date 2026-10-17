import assert from "node:assert/strict";
import test from "node:test";
import { runGenesisAgentProof } from "../scripts/genesis-agent-proof";

test("GENESIS AGENT PROOF #000001 executes real repo:read and independently verifies the full Trust Fabric chain", async () => {
  const artifact = await runGenesisAgentProof({
    approved_base_sha: "42306c18c819ebabe1c3aa27506b780d61aa0fd4",
    execution_branch_head: "GENESIS_TEST",
    now: new Date("2026-10-17T12:00:00.000Z"),
  });

  assert.equal(artifact.schema, "osa.genesis_agent_proof.v1");
  assert.equal(artifact.proof_number, "000001");
  assert.equal(artifact.agent_identity.ai_id, "@ai:osatechgpt.dev/agents/genesis");
  assert.equal(artifact.controller.ai_id, "@ai:osatechgpt.dev");
  assert.equal(artifact.source.operation, "repo:read");
  assert.equal(artifact.source.target, "package.json");
  assert.match(artifact.source.package_sha256, /^[0-9a-f]{64}$/);
  assert.ok(artifact.source.package_bytes > 0);

  assert.equal(artifact.evidence.length, 1);
  assert.equal(artifact.evidence[0].kind, "repo_read");
  assert.equal(artifact.evidence[0].data.status, "READ_OK");
  assert.equal(artifact.evidence[0].content_sha256, artifact.source.package_sha256);

  assert.equal(artifact.action_receipts.length, 1);
  assert.equal(artifact.proof_receipt.verdict, "VERIFIED");
  assert.equal(artifact.proof_batch.proof_receipt_sha256, artifact.proof_receipt.receipt_sha256);
  assert.equal(artifact.proof_batch.receipt_digests[0], artifact.action_receipts[0].receipt_digest);

  for (const value of Object.values(artifact.verification)) assert.equal(value, true);
  assert.match(artifact.artifact_sha256, /^[0-9a-f]{64}$/);

  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /BEGIN PRIVATE KEY/);
  assert.ok(artifact.delegation.scopes.includes("repo:read"));
  for (const denied of ["repo:write", "git:commit", "git:push", "production:deploy", "network:write", "blockchain:write"]) {
    assert.ok(artifact.delegation.denied_scopes.includes(denied));
  }
});
