# Chat → model → artifact → evidence

This guide describes the existing ChatDelivery path. It is distinct from the signed Durable chat path and its Devnet Registry integration, documented in [Durable Bridge](./DURABLE_REMOTE_BRIDGE.md) and [Registry](./PROOF_REGISTRY_DEVNET.md).

In fleet chat, choose Create artifact, select HTML application or Markdown document, enter the objective and submit.

1. The API accepts the objective, conversation_id and execution_id; checks session, origin, free-tier acknowledgement and call limits.
2. The existing MissionKernel executes the ten Delivery Lab roles. Kernel-recorded events are streamed to chat over SSE, rather than a simulated animation or private model reasoning.
3. Native scope planning precedes the producer's configured NVIDIA call. In connected mode the producer returns the complete file; a model failure does not silently fall back to a template.
4. Subsequent roles check bytes, SHA-256, structure, script syntax and declared gates. This original ChatDelivery path does not imply sandbox execution or deployment.
5. The kernel seals evidence, ProofReceipt and MissionReceipt. The browser independently recomputes bundle, artifact and proof digests, then opens trace/replay in existing views.
6. Downloads: artifact, full JSON bundle, evidence JSON, trace JSONL, ProofReceipt JSON and standalone Replay HTML. Offline Replay verifies integrity and displays recorded events; it does not rerun tools.

## Configuration

- Server-side NVIDIA_API_KEY.
- OSA_NVIDIA_FREE_TIER_ACK=true: required acknowledgement of free access, not an assurance of billing status for an arbitrary account/model. Do not enable paid use without explicit approval.
- OSA_DELIVERY_MODEL: explicit model for this path, historically defaulting to openai/gpt-oss-20b. Separate artifact-generation configuration, without silent fallback or changing the ordinary conversation model.
- GET /chat/delivery/status and POST /chat/delivery; Vercel uses the /api prefix.

## Evidence boundaries

A model can produce defective code or an incomplete document. Positive verification establishes integrity, recorded execution and specified checks, not factual truth, arbitrary-code safety or satisfaction of every user requirement. HTML preview uses an opaque iframe without same-origin and a network-blocking CSP.

The original path uses the existing MissionStore. Its execution_id fence cache is per instance, not globally exactly-once. Identical replay of a completed operation in the same instance returns the prior bundle; conflicting, active or uncertain execution is not automatically repeated. Disconnect is reported as unconfirmed and preserves the identifier in the error. The downloaded bundle is an enduring export; browser history persists only if local storage is available.

The separate [Durable path](./DURABLE_REMOTE_BRIDGE.md) supports persisted jobs on its designated host. Do not infer cross-device persistence or universal exactly-once semantics.

Since PR #24 the ChatDelivery path can use server-side remember=true → recall → model → Runtime/Proof → VERIFIED_RUNTIME readback only with verified private NeurOSA configured. memory_status=VERIFIED requires a real receipt; UNAVAILABLE means storage was not confirmed. READY deployment and local fixtures are not proof of durable production memory.

## NeurOSA × ChatDelivery (feature-gated)

The historical private-production acceptance gate requires OSA_NEUROSA_PRODUCTION_ENABLED=enabled, OSA_AUTH_MODE=session, OSA_NEUROSA_STORAGE_VERIFIED=true, configured GitHub OAuth allowlist, server-bound organization_id and project_id, and the approved host. Do not enable flags without verifying persistence and session scope.

The intended path is identity validation, optional message storage, recall, actual model generation, canonical evidence/ProofReceipt and confirmed VERIFIED_RUNTIME write. Report errors explicitly. Browser history is not a replacement for server persistence, and anonymous users must not access private memory.

See the [historical migration/acceptance gate](./NEUROSA_LIVE_ACCEPTANCE_2026-10-26.md). Production recall after restart is not established by the signed Durable chat milestone.

## Validation

npm test covers local HTTP/SSE, progress before generation completes, identifier binding, denial and retry fencing. The controlled test generator is not a production fallback.

`node scripts/test-chat-delivery-browser.cjs` covers Android/desktop: prompt, progress, runtime, six downloads and hashes, functional artifact in an isolated iframe, Replay, offline HTML and restoration after refresh. Controlled transport and real runtime are distinct from a live provider call, which needs independently confirmed zero-cost configuration.

## Export and independent audit — historical 2026-10-28 contract

Download the six files from one execution: artifact, *-bundle.json, *-evidence.json, *-trace.jsonl, *-proof.json and *-replay.html. The bundle schema is osa.chat_delivery.v1; bundle.record is the mission record. Trace JSONL contains record.timeline entries, one JSON object per line. scripts/verify-mission-record.cjs expects osa.mission.v1 (a Studio mission export or bundle.record), not the entire ChatDelivery bundle.

The client checks bundle_sha256, execution binding, Proof and artifact-byte hash. Offline Replay checks integrity and replays events, not actual worker actions. A historical operator observation of 47 Replay entries is not 47 tool calls. Do not equate timeline entries, AGENT_STARTED and tool operations.

For the bounded offline audit, see [Proof Export guide](./PROOF_EXPORTS_GUIDE.md) and [historical Hermes quickstart](./HERMES_AUDIT_QUICK_START.md). The earlier [security verdict](./final-boss/SECURITY_VERDICT.md) is a dated baseline, not a blanket claim about the later signed Devnet milestone. Independent security and general production acceptance remain open.
