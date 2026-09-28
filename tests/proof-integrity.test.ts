import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { EvidenceRecord, Mission, ProofReceipt, RunResult, TeamGraph } from "../packages/contracts/src";
import {
  CanonicalizationError,
  canonicalJson,
  DeterministicProofVerifier,
  digest,
  digestWithout,
  sealProofReceipt,
  verifyProofReceipt,
} from "../packages/proof-core/src";
import { ExecutorRegistry, OsaRuntime } from "../packages/runtime/src";

const CREATED_AT = "2026-09-28T12:00:00.000Z";
const CONTENT = "proof outlasts the claim";
const CONTENT_SHA = createHash("sha256").update(CONTENT, "utf8").digest("hex");

function graph(version = "1"): TeamGraph {
  return {
    organization_id: "org_integrity",
    project_id: "project_integrity",
    team_id: "team_integrity",
    version,
    agents: [
      { agent_id: "planner", role: "planner", executor_ref: "planner.v1" },
      { agent_id: "builder", role: "builder", executor_ref: "builder.v1" },
    ],
    edges: [{ edge_id: "p_to_b", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
  };
}

function mission(overrides: Partial<Mission> = {}, requirementAgent = "builder"): Mission {
  return {
    organization_id: "org_integrity",
    project_id: "project_integrity",
    mission_id: "mission_integrity",
    team_id: "team_integrity",
    team_version: "1",
    objective: "build a hashed artifact",
    entry_agent_id: "planner",
    input: { request: "build" },
    requirements: [
      {
        requirement_id: "artifact_status",
        type: "evidence_field_equals",
        evidence_kind: "artifact",
        agent_id: requirementAgent,
        field: "status",
        expected: "built",
      },
    ],
    ...overrides,
  };
}

type BuilderMode = "built" | "rejected" | "wrong-claim" | "claim-without-content" | "throw";

function registry(builder: BuilderMode | (() => BuilderMode) = "built", plannerEvidence = false): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register("planner.v1", () => ({
    output: { plan: "build" },
    evidence: plannerEvidence
      ? [{ kind: "artifact", data: { status: "built", content_sha256: CONTENT_SHA }, content: CONTENT }]
      : [{ kind: "plan", data: { status: "ready" } }],
  }));
  registry.register("builder.v1", () => {
    const mode = typeof builder === "function" ? builder() : builder;
    if (mode === "throw") throw new Error("builder crashed");
    if (mode === "rejected") return { output: { artifact: null }, evidence: [{ kind: "artifact", data: { status: "rejected" } }] };
    const claim = mode === "wrong-claim" ? createHash("sha256").update("something else").digest("hex") : CONTENT_SHA;
    return {
      output: { artifact: { content: CONTENT } },
      evidence: [
        {
          kind: "artifact",
          data: { status: "built", content_sha256: claim, evidence_sha256: "deadbeef" },
          ...(mode === "claim-without-content" ? {} : { content: CONTENT }),
        },
      ],
    };
  });
  return registry;
}

let executionCounter = 0;
function runtime(reg: ExecutorRegistry): OsaRuntime {
  return new OsaRuntime(reg, {
    clock: () => new Date(CREATED_AT),
    createExecutionId: () => `exec_test_${++executionCounter}`,
  });
}

function receiptBody(receipt: ProofReceipt) {
  const { proof_id: _id, receipt_sha256: _sha, ...body } = receipt;
  return body;
}

function check(result: RunResult) {
  return verifyProofReceipt({
    receipt: result.proof,
    evidence: result.evidence,
    observations: result.observations,
    final_output: result.final_output,
  });
}

function reverify(result: RunResult, g: TeamGraph, m: Mission, evidence: EvidenceRecord[], executionId = result.execution_id) {
  return new DeterministicProofVerifier().verify({
    run_id: OsaRuntime.createRunId(g, m),
    execution_id: executionId,
    graph: g,
    mission: m,
    evidence,
    final_output: result.final_output,
    created_at: CREATED_AT,
  }).proof;
}

test("canonical JSON is key-order independent and rejects ambiguous values", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, undefined], c: "x" } }), '{"a":{"c":"x","d":[1,null]},"b":1}');
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.equal(digest({ a: 1, skip: undefined }), digest({ a: 1 }));
  assert.throws(() => canonicalJson({ n: Number.NaN }), CanonicalizationError);
  assert.throws(() => canonicalJson({ n: Infinity }), CanonicalizationError);
  assert.throws(() => canonicalJson({ m: new Map() }), CanonicalizationError);
});

test("valid run: core-computed digests, clean observations, sealed receipt", async () => {
  const result = await runtime(registry()).run(graph(), mission());
  assert.equal(result.verdict, "VERIFIED");

  const artifact = result.evidence.find((record) => record.kind === "artifact")!;
  assert.equal(artifact.provenance, "EXECUTOR_EVIDENCE");
  assert.equal(artifact.content_sha256, CONTENT_SHA);
  assert.equal(artifact.content_bytes, Buffer.byteLength(CONTENT, "utf8"));
  assert.equal(artifact.binding.execution_id, result.execution_id);
  assert.equal(artifact.producer.agent_id, "builder");
  assert.match(artifact.producer.operation_id, new RegExp(`^${result.execution_id}:op:2:builder$`));
  assert.equal(artifact.evidence_sha256, digestWithout(artifact, "evidence_sha256"));
  assert.ok(!("content" in artifact), "raw content must not be stored");

  assert.ok(result.observations.length > 0);
  assert.ok(result.observations.every((observation) => observation.ok && observation.provenance === "VERIFIER_OBSERVATION"));
  assert.ok(result.observations.some((observation) => observation.check === "content_digest"));

  assert.equal(result.proof.schema, "osa.proof_receipt.v2");
  assert.equal(result.proof.receipt_sha256, digest(receiptBody(result.proof)));
  assert.equal(result.proof.proof_id, `proof_${result.proof.receipt_sha256}`);
  assert.equal(result.proof.evidence_root, digest(result.proof.evidence_refs));
  assert.equal(result.proof.final_output_sha256, digest(result.final_output));
  assert.equal(result.proof.created_at, CREATED_AT);
  assert.deepEqual(check(result), { ok: true, errors: [] });
  // Digests survive the JSON round trip the HTTP API performs.
  assert.deepEqual(check(JSON.parse(JSON.stringify(result)) as RunResult), { ok: true, errors: [] });
});

test("executor-supplied evidence_sha256 in data never defines record identity", async () => {
  const result = await runtime(registry()).run(graph(), mission());
  const artifact = result.evidence.find((record) => record.kind === "artifact")!;
  assert.equal(artifact.data.evidence_sha256, "deadbeef");
  assert.notEqual(artifact.evidence_sha256, "deadbeef");
  assert.match(artifact.evidence_sha256, /^[0-9a-f]{64}$/);
});

test("1. tampered artifact content: claimed digest differs from content -> FAILED", async () => {
  const result = await runtime(registry("wrong-claim")).run(graph(), mission());
  assert.equal(result.verdict, "FAILED");
  const observation = result.observations.find((item) => item.check === "content_digest");
  assert.equal(observation?.ok, false);
  assert.match(result.proof.requirement_verdicts[0].reason, /content_digest/);
});

test("1b. claimed content digest without content -> FAILED", async () => {
  const result = await runtime(registry("claim-without-content")).run(graph(), mission());
  assert.equal(result.verdict, "FAILED");
});

test("1c. artifact content changed in final output after sealing is detected", async () => {
  const result = await runtime(registry()).run(graph(), mission());
  const tampered = structuredClone(result.final_output) as { artifact: { content: string } };
  tampered.artifact.content = "forged";
  const verdict = verifyProofReceipt({ ...{ receipt: result.proof, evidence: result.evidence, observations: result.observations }, final_output: tampered });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.includes("final output")));
});

test("2. evidence replayed from another run cannot satisfy a requirement", async () => {
  const first = await runtime(registry()).run(graph(), mission());
  const otherAttempt = mission({ attempt: 2 });
  const proof = reverify(first, graph(), otherAttempt, first.evidence, "exec_other_run");
  assert.notEqual(OsaRuntime.createRunId(graph(), otherAttempt), first.run_id);
  assert.equal(proof.verdict, "FAILED");
  assert.match(proof.requirement_verdicts[0].reason, /binding/);
});

test("3. evidence replayed from another execution of the same run is rejected", async () => {
  const first = await runtime(registry()).run(graph(), mission());
  const proof = reverify(first, graph(), mission(), first.evidence, "exec_replay_target");
  assert.equal(proof.run_id, first.run_id);
  assert.equal(proof.verdict, "FAILED");
  assert.match(proof.requirement_verdicts[0].reason, /binding/);
});

test("3b. re-running a mission never reuses a previous execution's evidence or events", async () => {
  let call = 0;
  const shared = runtime(registry(() => (++call === 1 ? "built" : "rejected")));
  const first = await shared.run(graph(), mission());
  const second = await shared.run(graph(), mission());

  assert.equal(first.verdict, "VERIFIED");
  assert.equal(second.run_id, first.run_id);
  assert.notEqual(second.execution_id, first.execution_id);
  assert.equal(second.verdict, "FAILED");
  assert.ok(second.evidence.every((record) => record.execution_id === second.execution_id));
  assert.ok(second.events.every((event) => event.execution_id === second.execution_id));
  const ids = [...first.events, ...second.events].map((event) => event.event_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(second.proof.proof_id, first.proof.proof_id);
});

test("4. evidence bound to a different mission is rejected", async () => {
  const first = await runtime(registry()).run(graph(), mission());
  const otherMission = mission({ mission_id: "mission_other" });
  const proof = reverify(first, graph(), otherMission, first.evidence);
  assert.equal(proof.verdict, "FAILED");
  assert.match(proof.requirement_verdicts[0].reason, /binding/);
});

test("5. evidence bound to a different Team Graph version is rejected", async () => {
  const first = await runtime(registry()).run(graph(), mission());
  const proof = reverify(first, graph("2"), mission({ team_version: "2" }), first.evidence);
  assert.equal(proof.verdict, "FAILED");
  assert.match(proof.requirement_verdicts[0].reason, /binding/);
});

test("6. evidence modified after hashing is rejected and detected", async () => {
  const result = await runtime(registry("rejected")).run(graph(), mission());
  assert.equal(result.verdict, "FAILED");

  const forged = structuredClone(result.evidence);
  forged.find((record) => record.kind === "artifact")!.data.status = "built";
  const proof = reverify(result, graph(), mission(), forged);
  assert.equal(proof.verdict, "FAILED");
  assert.match(proof.requirement_verdicts[0].reason, /modified after hashing/);

  const integrity = verifyProofReceipt({ receipt: result.proof, evidence: forged, observations: result.observations, final_output: result.final_output });
  assert.equal(integrity.ok, false);

  // Recomputing the record digest is possible without a key; the sealed receipt still exposes it.
  const recomputed = forged.map((record) => ({ ...record, evidence_sha256: digestWithout(record, "evidence_sha256") }));
  const stillDetected = verifyProofReceipt({ receipt: result.proof, evidence: recomputed, observations: result.observations, final_output: result.final_output });
  assert.ok(stillDetected.errors.includes("evidence does not match receipt evidence_refs"));
});

test("7. receipt modified after creation is detected", async () => {
  const result = await runtime(registry("rejected")).run(graph(), mission());

  const flippedVerdict: ProofReceipt = { ...structuredClone(result.proof), verdict: "VERIFIED" };
  assert.ok(check({ ...result, proof: flippedVerdict }).errors.includes("receipt_sha256 does not match receipt contents"));

  const droppedRequirements: ProofReceipt = { ...structuredClone(result.proof), requirement_verdicts: [] };
  assert.equal(check({ ...result, proof: droppedRequirements }).ok, false);

  const resealed = sealProofReceipt({ ...receiptBody(result.proof), verdict: "VERIFIED" });
  assert.notEqual(resealed.proof_id, result.proof.proof_id);
});

test("8. runtime failure: proof_id commits to FAILED, never to a prior VERIFIED state", async () => {
  const result = await runtime(registry("throw", true)).run(graph(), mission({}, "planner"));

  assert.equal(result.verdict, "FAILED");
  assert.equal(result.proof.runtime_failure, "builder crashed");
  const runtimeVerdict = result.proof.requirement_verdicts.at(-1);
  assert.equal(runtimeVerdict?.requirement_id, "__runtime_execution__");
  assert.equal(result.proof.requirement_verdicts[0].verdict, "VERIFIED");

  assert.equal(result.proof.proof_id, `proof_${digest(receiptBody(result.proof))}`);
  const { runtime_failure: _failure, ...withoutFailure } = receiptBody(result.proof);
  const hypotheticalVerified = sealProofReceipt({
    ...withoutFailure,
    verdict: "VERIFIED",
    requirement_verdicts: result.proof.requirement_verdicts.slice(0, -1),
  });
  assert.notEqual(result.proof.proof_id, hypotheticalVerified.proof_id);
  assert.deepEqual(check(result), { ok: true, errors: [] });

  const failedEvent = result.events.find((event) => event.type === "RUN_FAILED");
  assert.equal(failedEvent?.payload.proof_id, result.proof.proof_id);
});
