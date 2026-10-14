# Mastra × OSA Proof: Phase 08 experimental adapter

This is a **delegated tool implementation**, not a Mastra package or a global interception hook. A Mastra tool's execute handler can call `createMastraOsaTool(...)`. No Mastra SDK dependency is installed.

## Preconditions
- Authenticated HTTPS OSA Proof API; **never** the `OSA_AUTH_MODE=open` preview.
- Pre-registered TeamGraph and a trusted `missionFactory` returning a fully validated Mission.
- OSA Mission Kernel and proof verifier configured by the operator.
- One allowlisted, side-effect-free fixture tool for initial tests.

## Behavior
1. POST /missions (rejects duplicate mission_id)
2. POST /missions/:id/run (no automatic retries)
3. GET /missions/:id/receipt
4. Return Mastra-to-OSA correlation with explicit `CORRELATED_NOT_INDEPENDENTLY_VERIFIED`.

## Critical limitations
- This adapter does **not** independently verify receipt hashes, tool authorization, user identity, or Mastra hook bypass.
- Receipt cross-run binding and durable idempotency are **not proven**. Do not use for external side effects.
- The adapter does not import Mastra. Real SDK tool binding, end-to-end tests, and compatibility remain NOT RUN.
- No secrets or tool inputs are logged.
- Tests: `node --test tests/mastra-osa-adapter.test.mjs` (not executed in Phase 08).
