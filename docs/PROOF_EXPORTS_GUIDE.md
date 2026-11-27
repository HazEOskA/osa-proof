# Proof Export and Replay — interpretation and independent verification

Read-only audit mode: use local copies, do not start production services or send private data to external APIs. The original November 3 artifact audit is retained below; signed Durable chat was added later.

## Distinct evidence formats

| UI path | Format | Purpose |
| --- | --- | --- |
| Fleet chat → Create artifact | osa.chat_delivery.v1 | Artifact, record, run, bundle_sha256, Evidence, Proof and Replay |
| Build → Studio → Download mission record | osa.mission.v1 | MissionKernel record, checked by verify-mission-record.cjs |
| Fleet chat → Live Trace | osa.live_execution.v1 / osa.live_metadata.v1 | Observed UI/SSE events; may contain BROWSER metadata rather than a full proof |
| Signed Durable chat → audit export | osa.chat_audit.v1 with signed_trust | Execution audit, ProofReceipt V2, identity, delegation, software attestation, signed ActionReceipt and Merkle batch/inclusions when configured |

Replay displays recorded events; it does not re-execute the model or tools. Event count is not tool-call count. VERIFIED may concern only a specified requirement such as delivery_ready_for_review.

## ChatDelivery files and checks

Use *-bundle.json, *-evidence.json, *-trace.jsonl, *-proof.json, the HTML/Markdown artifact and *-replay.html from the same execution_id. A missing file means partial audit, not a fabricated PASS.

Use the built repository and matching format/version from the [Hermes offline audit quickstart](./HERMES_AUDIT_QUICK_START.md). scripts/verify-mission-record.cjs accepts osa.mission.v1, not the entire osa.chat_delivery.v1 bundle.

1. Check JSON/JSONL, schemas and execution_id/run_id/mission_id binding.
2. Recompute bundle SHA-256 over canonical JSON excluding bundle_sha256.
3. Recompute ProofReceipt without proof_id and receipt_sha256; proof_id is proof_ + digest.
4. Verify each evidence_sha256, evidence_root, final_output_sha256, observations and records with the existing verifier.
5. Verify artifact bytes/hash/content, trace JSONL against record.timeline, and proof/evidence against run.
6. On a copy, test rejection of changed bytes, missing event and mismatched execution_id.
7. Record AGENT_STARTED count, tool_calls, distinct producer.executor_ref, BROWSER versus API origin, and signature/egress status.

## Signed Durable chat

For a configured signed run, also verify the controller-signed delegation and the independently trusted agent public key; verify the ActionReceipt and software runtime-attestation signatures, recompute the batch, check both Merkle inclusions and execution/input/output binding. Compare the expected batch and root with the finalized Registry transaction and account state using the [Registry protocol](./PROOF_REGISTRY_DEVNET.md).

The job status may include registry_anchor separately from the chat audit. Do not equate a UI label or a batch prepared offline with an independently checked finalized commitment. The V2 receipt itself remains unsigned; the separate ActionReceipt supplies the signature. A valid signature and inclusion proof do not establish semantic truth or hardware-backed provenance.

The [2026-11-27 evidence report](./STATUS_2026-11-27.md) lists two verified production-connected executions and public commitments. Private production exports are not public. The distinct local test bundle can be reproduced with the public Registry verifier after building.

## Historical example — 2026-11-03

- record.timeline: 65 events; run.events: 47.
- AGENT_STARTED: 10 (demo.* stages).
- run.evidence: 13; run.observations: 27; run.tool_calls: 0.
- run.verdict: VERIFIED for delivery_ready_for_review.
- Local audit: matching bundle and ProofReceipt hashes, 13/13 evidence, artifact content/bytes/hash, Evidence/Proof/trace exports.
- egress_status: NOT_ENFORCED; signature_status: UNAVAILABLE.

Conclusion for that export: model → artifact → policy/structural checks → ProofReceipt → export worked in the audited scenario. It does not prove real repository-file operations by two independent workers. HTML text mentioning config.txt, receipt1 or Worker 2 was demonstration content, not runtime evidence. Historical format verdict: PASS_LOCAL_INTEGRITY_ONLY; real two-worker E2E was NOT PROVEN by that export.

## Privacy and publication

Do not publish private bundles, conversation IDs, memory, prompts or secrets. New public evidence requires operator authorization, redaction, source and exact SHA, and a stated reproduction boundary. Without signatures or an external commitment, a completely rewritten bundle may be consistently resealed. Even with them, independently establish the trust anchor and do not infer semantic correctness from integrity.
