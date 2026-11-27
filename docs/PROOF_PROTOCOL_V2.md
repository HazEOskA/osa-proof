# Proof Protocol v2 — Integrity

Extends `PROOF_PROTOCOL_V1.md`. V1 principles are unchanged: **CLAIM != PROOF**, and
`VERIFIED` is produced only by deterministic evaluation of evidence.

V2 adds the smallest integrity primitive: execution binding, content-addressed evidence,
typed provenance and a sealed receipt. It does **not** add signatures, PKI, KMS, Merkle
logs or attestation. Every digest is a plain SHA-256 that anyone can recompute, so V2
detects inconsistent tampering and replay, not an attacker who rewrites everything.
The original V2 receipt remains unsigned. The separate [Agent Trust Fabric](./AGENT_TRUST_FABRIC_V0_1.md) signs ActionReceipts and includes the V2 receipt digest in a Merkle ProofBatch. [Devnet Registry evidence](./STATUS_2026-11-27.md) demonstrates finalized external commitments without changing the V2 schema.

## Canonical form

Digests use canonical JSON (`packages/proof-core/src/canonical.ts`): object keys sorted,
undefined object members omitted, undefined array items as `null`, `Date` as ISO string.
Non-finite numbers, bigint, functions, symbols and non-plain objects are rejected.

## Execution binding

```text
ExecutionBinding { organization_id, project_id, team_id, team_version,
                   mission_id, run_id, execution_id }
```

- `run_id` stays deterministic per mission attempt.
- `execution_id` is unique per `OsaRuntime.run()` call.
- Each agent step has `operation_id = <execution_id>:op:<index>:<agent_id>`.

Evidence is collected per execution. Evidence whose binding differs from the execution
being verified never satisfies a requirement.

## Evidence

| Field | Set by |
|---|---|
| `kind`, `data` | executor (claims) |
| `content` (input only) | executor; hashed by core, not stored |
| `binding`, `producer`, `provenance = EXECUTOR_EVIDENCE` | core |
| `content_sha256`, `content_bytes` | core |
| `evidence_sha256` = digest of the record without itself | core |

Executor-supplied hash fields inside `data` are claims only. A claimed
`data.content_sha256` must equal the core-computed `content_sha256`.

## Verifier observations

`VERIFIER_OBSERVATION` records are produced by the verifier for each evidence record:
`binding`, `evidence_digest` and, when content is involved, `content_digest`.
They run in the same process as the runtime: this separates provenance so an independent
verifier can be added later, it does not establish external trust.

A requirement is evaluated only over evidence that passed every check. If any candidate
evidence fails a check the requirement is `FAILED`.

## Receipt

The verifier receives the runtime failure (if any) as input, decides the final verdict,
and only then seals the receipt:

```text
receipt_sha256 = digest(receipt without proof_id and receipt_sha256)
proof_id       = "proof_" + receipt_sha256
```

The sealed body commits to: binding, verdict, requirement verdicts, runtime failure,
`evidence_refs` (id + digest per record), `evidence_root = digest(evidence_refs)`,
`observation_refs`, `final_output_sha256`, `created_at` and verifier identity.

**2026-10-31 extension — Attribution Gate v1:** receipts may additionally include `attribution_mode`, `claim_attribution`, `tool_call_refs`, `tool_call_root`, `egress_status: NOT_ENFORCED` and `signature_status: UNAVAILABLE`. The runtime creates `ToolCallRecord` through `context.callTool()`; `tool_call_root` binds record digests to the execution. Claim checking is DEFAULT_ON but is a limited heuristic. The chat path uses REPORT_ONLY. [Full contract](./ATTRIBUTION_GATE_V1.md).

`verifyProofReceipt({ receipt, evidence, observations, final_output, tool_calls })` checks digests and, when tool references exist, the consistency of ToolCallRecord entries and the tool-call root. It does not independently attest external data provenance.

## Not covered by V2

- `status` values remain executor claims; V2 binds them and makes them tamper-evident,
  it does not judge artifact quality.
- Runtime events are correlated by `execution_id` and carry `evidence_sha256`, but are not
  hash-chained.
- Supported external claims are modeled as `ClaimAttribution`; classification is not exhaustive across arbitrary statements or dynamic code.
- V2 itself does not enforce network egress or sandboxing (`NOT_ENFORCED`) and its own signature remains `UNAVAILABLE`. The signed ActionReceipt is a separate artifact. Hash integrity alone does not establish origin.
- A claim that an API integration was completed requires separate deployment and execution evidence; HTTP 200 alone is insufficient.
