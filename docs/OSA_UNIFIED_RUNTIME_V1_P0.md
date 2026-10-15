# Issue 14: P0 activation — PARTIAL / BLOCKED

Existing PRs only: OSA Proof #13 and Jeverson #5. No merge, production deployment, provisioned infrastructure, paid completion, or production memory access was performed.

## Implemented

- Both projects now require Vercel Authentication on **preview only**. The old Jeverson deployment's public protection override was revoked. Production protection targets and production provider variables were not changed.
- Jeverson preview uses real OpenAI-compatible `tool_calls` from NVIDIA/OpenRouter. It does not call the chargeable JEV alpha decision API. Three allowlisted read-only tools dispatch through the existing OSA Runtime. Plain model answers also get a Runtime evidence bundle (`conversation.record`). Unknown tools and multiple simultaneous calls are BLOCKED.
- One server-generated `exec_…` binds provider response ID/hash, chosen tool/arguments, events, evidence and receipt. Model provenance is server-reported; hash verification is **not independent provider attestation**.
- Model dispatch requires a separate server-only bearer credential, configured on both PR branches. Browser origins are checked on cockpit/Hermes POSTs; requests are limited to 12 per 10 minutes per IP **per process instance**. This rate limit is not a durable budget. The financial boundary is zero-cost models plus a zero-spend provider key.
- OpenRouter requires an exact server allowlist and a live catalog entry with tool support and zero pricing (including request fees). The default `nvidia/nemotron-3.5-lightning:free` was present with tools and zero prompt/completion pricing in the public catalog on 2026-10-15. No completion was purchased. Paid fallback models are disabled. NVIDIA is blocked unless the operator explicitly attests a nonbillable free tier.
- Hermes and imported declarative workers remain. Hermes shares preview origin/rate/cost gates; approving a Hermes proposal still does not execute a mutation.
- NeurOSA keeps its existing server token, operator session and per-message opt-in. Preview additionally requires `NEUROSA_PREVIEW_BRAIN_ID`; recall must match that brain and a valid ledger. No existing brain was written.
- Native Builder requires a short-lived signed grant binding execution, repository, prompt, branch, agent, model and dependency installation. It exports a bounded patch plus SHA-256 and **never commits or pushes**. Its execution gate remains disabled: no isolated worker or durable approval/replay service is configured in preview. There is no completed build to claim.
- Parent/iframe handshake detects a missing chat. A login/reload instruction remains visible when SSO cannot load inside the frame. Stored bundles can be restored from the existing browser chat history and are reverified before appearing in Tracing/Proofs. Restoration is explicitly labeled; API process memory is not called durable storage.

## One-time operator setup (no secrets in chat)

All entries below are **Preview**, filtered to `feature/osa-unified-runtime-v1`. Do not edit production entries or add client/public-prefixed secrets.

1. In Vercel **aether → Settings → Environment Variables**, add separate `OPENROUTER_API_KEY` (zero spending limit) and `NVIDIA_API_KEY` (only a confirmed nonbillable developer tier). Existing production values are sensitive/redacted and cannot be copied by this connector. OpenRouter allowlist/model are already configured. NVIDIA remains cost-blocked until an operator has confirmed free-only use and set `OSA_NVIDIA_FREE_TIER_ACK=true`, with the intended `NVIDIA_MODEL`. Do not enable that acknowledgement for a billable endpoint.
2. In **osa-proof → Settings → Deployment Protection → Protection Bypass for Automation**, create a dedicated server automation secret, preserving Vercel Authentication. Copy it into `OSA_RUNTIME_PROTECTION_BYPASS` on **both** preview branches (aether needs it for Runtime POST; OSA needs it for its own diagnostic GETs). Do not use a public share link or expose it to frontend code. The connector's creation attempt returned **403 forbidden**; no authenticated CLI is available. The separate `OSA_UNIFIED_RUNTIME_TOKEN` has already been configured securely on both preview branches.
3. Redeploy both preview branches after adding the values. The aether preview must remain protected. OSA's iframe origin uses the aether branch alias, so future preview redeploys keep that origin stable.
4. For NeurOSA, supply an **existing authorized preview brain**: `NEUROSA_API_URL`, scoped `NEUROSA_API_TOKEN`, `NEUROSA_PREVIEW_BRAIN_ID`, `NEUROSA_OPERATOR_PASSWORD` (16+ characters), `NEUROSA_SESSION_SECRET` (32+). Confirm persistent volume/restart evidence before claiming persistence. Log in with the existing NeurOSA operator UI and explicitly enable memory. No production brain fallback is allowed.
5. For worker execution, supply the existing authorized `OSA_WORKER_BASE_URL` and scoped `OSA_WORKER_TOKEN` in OSA preview, then test the actual workspace lifecycle. A `/health` response alone does not prove Docker/build execution. Do not provision paid hosting. Native Builder stays blocked until the worker and operator approval service are available; do not merely flip its environment switch.

## Acceptance and evidence

- Latest local real browser runs: `docs/evidence/unified-v1-p0-browser.json`. No replaced network requests or provider simulations in browser E2E. Desktop and Android-emulated 390×844: normal Jeverson chat → actual Node SHA-256 → OSA Runtime → Tracing → Proofs, then reload and reverify the stored bundle.
- Backend suite: 223 passed, 3 pre-existing skips. Jeverson/Hermes/NeurOSA/security contracts: 29 passed. New negatives cover foreign/missing Origin, rate exhaustion, paid model denial before a completion, absent pricing, missing preview brain identity, unsigned builder approval, unauthorized model dispatch and proof tampering. A fresh API state verifies an exported bundle after in-memory run loss.
- Backend, worker host, dashboard and Next.js builds passed. Physical Android and authenticated cloud model/tool E2E are **not yet accepted**.
- Historical cloud receipts in `unified-v1-cloud.json` are from the previous native-only run, not evidence of a model call in this P0 run.
- Overall remains **PARTIAL/BLOCKED** until a real preview model response, actual model tool call, authenticated iframe/mobile flow, preview memory persistence and isolated worker execution are evidenced. A green unit suite does not meet that gate.
