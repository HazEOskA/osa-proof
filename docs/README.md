# OSA Proof — technical documentation

Primary language: English. Historical reports may retain their original language and dated scope.

Start with the [public developer documentation](https://osa-proof-three.vercel.app/docs) and the [2026-11-27 execution evidence](./STATUS_2026-11-27.md). Current documented milestone: two completed, signed Jeverson chat jobs independently checked against finalized Solana Devnet commitments. The source baseline for that milestone is `fce23a1aacd105c840e6ca7bd8f58e5214c5b5bc`. This does not imply Mainnet, independent security certification or general availability.

## Core contracts and integration

| Topic | Reference |
| --- | --- |
| Product architecture | [Architecture Lock](./ARCHITECTURE_LOCK_V1.md), [Backend foundation](./BACKEND_ARCHITECTURE_LOCK_V1.md) |
| Team topology and execution | [Team Graph](./TEAM_GRAPH_CONTRACT_V1.md), [Mission Kernel](./MISSION_KERNEL_V1.md) |
| Proof and evidence | [Proof Protocol V1](./PROOF_PROTOCOL_V1.md), [Proof Protocol V2](./PROOF_PROTOCOL_V2.md), [Attribution Gate](./ATTRIBUTION_GATE_V1.md) |
| Identity, delegation, signatures | [Agent Trust Fabric](./AGENT_TRUST_FABRIC_V0_1.md) |
| Blockchain commitments | [Solana Devnet Registry](./PROOF_REGISTRY_DEVNET.md), [execution evidence](./STATUS_2026-11-27.md) |
| Durable execution | [Durable Remote Bridge](./DURABLE_REMOTE_BRIDGE.md), [public guide](https://osa-proof-three.vercel.app/docs#durable-runtime) |
| Developer/API reference | [Quickstart](https://osa-proof-three.vercel.app/docs#quickstart), [first mission](https://osa-proof-three.vercel.app/docs#first-mission), [HTTP API](https://osa-proof-three.vercel.app/docs#api) |
| Audit and Replay | [Proof exports and signed audit guide](./PROOF_EXPORTS_GUIDE.md), [current verification boundaries](./STATUS_2026-11-27.md) |
| Storage architecture | [Persistence proposal](./PERSISTENCE_ARCHITECTURE_V1_PROPOSAL.md) — proposed, not deployed PostgreSQL |

## Evidence hierarchy

1. Source at a pinned SHA describes what is implemented.
2. Local tests establish results in their stated environment only.
3. An offline export can establish consistency of the provided records.
4. Signatures and independently pinned keys add authentication within the declared trust model.
5. Finalized external commitments can establish inclusion and tamper evidence; they do not prove semantic truth or independently attest every real-world effect.
6. Restart, isolation, cross-device and security acceptance are separate gates.

UNKNOWN, NOT_REQUIRED, BLOCKED and SKIP are not PASS. Distinguish the ProofReceipt V2 integrity verdict from the signed ActionReceipt and Registry readback.

## Historical and specialized reports

- [2026-11-18 status](./STATUS_2026-11-18.md) — pre-Registry baseline; superseded for the two demonstrated signed chat runs.
- [2026-11-03 status](./STATUS_2026-11-03.md), [2026-10-31 status](./OSA_PROOF_STATUS_2026-10-31.md), [2026-10-28 preview](./OSA_PROOF_PREVIEW_STATUS_2026-10-28.md) — historical snapshots; do not aggregate their test counts.
- [History and workspace gaps](./HISTORY_AND_WORKSPACE_GAPS_2026-11-03.md), [storage proposal](./PERSISTENCE_ARCHITECTURE_V1_PROPOSAL.md).
- [Local worker host](./OSA_WORKER_HOST_V0.1.md), [older Durable P0](./P0_DURABLE_EXECUTION_20261103.md), [Live Trace](./P0_UNIFIED_LIVE_TRACE_20261103.md), [unified runtime preview](./OSA_UNIFIED_RUNTIME_V1.md).
- [Hermes offline audit quickstart](./HERMES_AUDIT_QUICK_START.md), [memory activation plan](./NEXT_STEP_MEMORY_ACTIVATION.md), [Builder research](./BUILD_RESEARCH_AND_VERIFICATION.md), [historical function matrix](./final-boss/OSA_PROOF_FUNCTION_MATRIX.md).

Historical documents remain intact as records of their respective baselines, including Polish text. The primary English documentation above takes precedence when describing the current milestone.

## Publication hygiene

Never commit private chat exports, secrets, session tokens, customer data or raw prompts without authorization and review. Publish only approved evidence and redact private context. A public transaction commitment does not reveal the underlying private execution by itself. Documentation is not authorization to change infrastructure.
