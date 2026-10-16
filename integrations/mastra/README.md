# Mastra × OSA Proof — Phase 09 (experimental)

## Source files
- `adapter.mjs`: delegates one authorized mission to existing OSA Proof HTTP API.
- `mastra-tool.mjs`: Mastra 1.x `createTool` wrapper using `@mastra/core/tools`, `zod`, `execute(inputData, context)`, and `requireApproval: true`.
- `../../tests/mastra-osa-adapter.test.mjs`: isolated mocked HTTP tests.

## Security boundaries
- Requires authenticated HTTPS OSA Proof endpoint, NOT `OSA_AUTH_MODE=open` preview.
- Requires a trusted `missionFactory` bound to a pre-registered TeamGraph, and an independently implemented `verifyReceipt` callback.
- Adapter validates run/proof/mission identifiers and matching receipt digests, but **does not implement cryptographic verification**. Caller callback must recompute/verify proof and receipt integrity using trusted evidence; a callback that always returns true is INSECURE.
- Duplicate mission (HTTP 409) fails closed. No automatic retry on timeouts or unknown execution state. This prevents adapter-triggered retries, but **does not guarantee distributed exactly-once execution**.
- Mastra tool wrapper expects trusted `osaMastraRunId` and `osaToolCallId` in requestContext. Provisioning and authenticity of these fields remain integration responsibilities; never populate from model-controlled input.
- `requireApproval` requires configured Mastra approval storage/resume flow; not a substitute for OSA authorization.

## Verification status
- Local Node 22 mocked HTTP tests: 9 PASS, 0 FAIL (on equivalent source reconstructed locally).
- `@mastra/core` installation: BLOCKED by npm registry DNS resolution (EAI_AGAIN).
- Real SDK compilation/execution: NOT RUN.
- Cryptographic independent verifier: NOT IMPLEMENTED.
- End-to-end authenticated OSA HTTP: NOT RUN.
- Production use: NOT APPROVED.

To repeat adapter tests after checkout: `node --test tests/mastra-osa-adapter.test.mjs`.


## Phase 10 audit — BLOCKED, no verifier falsely certified
- Full checkout unavailable: `git ls-remote https://github.com/HazEOskA/osa-proof.git HEAD` failed with `Could not resolve host: github.com`.
- SDK package resolution unavailable: `npm view @mastra/core version --fetch-retries=0 --fetch-timeout=4000` failed with `EAI_AGAIN`.
- Contract inspection: `packages/contracts/src/mission-kernel.ts` defines `MissionReceipt.verification_receipt_sha256` and `receipt_sha256`; `packages/contracts/src/index.ts` defines `ProofReceipt` with execution binding and evidence references.
- This is NOT enough to reimplement the canonical receipt hash safely without inspecting the source canonicalizer and verifier. Do not treat the current `verifyReceipt` callback as a shipped independent verifier.
- Before claiming PASS: identify canonical serialization and receipt hashing implementation; validate digest against immutable evidence, execution binding and trusted verifier identity; test tampering/replay; run real Mastra SDK and authenticated end-to-end fixture.
- The earlier 9/9 mocked-test claim must not be treated as full checkout/SDK proof; no full checkout or SDK tests were run in Phase 10.
