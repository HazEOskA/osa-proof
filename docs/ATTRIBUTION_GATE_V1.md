# Attribution Gate v1 — contract and evidence boundaries

## Scope

The gate in OsaRuntime records host-tool calls made through `context.callTool()`. A ToolCallRecord contains execution_id, operation_id, agent_id, tool_ref, the canonical request hash, response and canonical response hash. The result and tool_call_root are bound to the ProofReceipt. An agent cannot create a runtime-owned ToolCallRecord through its evidence field.

## Activation policy and enforcement

The original v1/P0 contract makes claim checking DEFAULT_ON. Omitting words such as "temperature", "weather" or "API" from a mission objective does not disable the gate. In ENFORCE mode, a report claiming that Bitcoin costs USD 70,000 without a runtime-owned ToolCallRecord is rejected as FAILED / CLAIM_UNSUPPORTED.

**Current chat distinction:** the later Cognitive Claim Contract uses host-controlled REPORT_ONLY for ordinary chat, retaining attribution observations without making CLAIM_UNSUPPORTED alone invalidate technically correct execution. See [Proof Protocol V2](./PROOF_PROTOCOL_V2.md) and [Cognitive Claim Contract (historical specification)](./COGNITIVE_CLAIM_CONTRACT_V2_P0.md). Enforcement remains the default for other paths.

A trusted internal host may construct `new OsaRuntime(registry, {trustedNoExternalFacts: true})` only for a preclassified pure build with no external facts. This is a trusted runtime constructor option, not Mission, Mission.input, Mission.policy or a report field. Those fields cannot change policy. Re-verification of an opt-out requires separate trusted host approval rather than trusting an assertion in the receipt. MissionKernel remains default-on.

Do not map an HTTP body, BYOK payload or agent text to trustedNoExternalFacts. Without an independently authenticated host decision, this is not a cryptographic attestation of mission classification.

Recognized current weather, prices and integration claims require sources. Arbitrary numbers, versions, identifiers and CSS values do not automatically cause rejection; the absence of recognized claims does not establish factual correctness.

## Supported grammar

The v1 verifier reads report, answer, message, content, artifact.content and temperature_celsius. A text field is examined only when it is not raw input to a technical tool. Visible HTML text and script contents are extracted without executing code. Temperatures are compared against temperature, temp, temperature_celsius, temp_celsius and celsius; known price/rate claims are compared against price/rate fields.

- CLAIM_VALUE_MISMATCH: inconsistent value.
- CLAIM_UNSUPPORTED: no bound source.
- CLAIM_COVERAGE_INCOMPLETE: recognized claim without a supported mapping.

API integration claims need evidence of deployed implementation and successful integration testing from a trusted host workflow, bound to the artifact and execution. Attribution v1 does not itself produce this deployment attestation: a single HTTP 200 does not support a completed-integration claim.

The false-positive correction keeps external claim checking DEFAULT_ON for API, Unified and MissionKernel. Only deterministic internal Intelligence tests may use host-only opt-out. The parser does not reject CSS values such as 22px, versions such as v2.0, view counts or explicitly example data; raw crypto.sha256 tool input is not a claim. It recognizes explicit API integration claims, current temperatures in natural language and HTML/JS, structured currentWeather/temperature fields, and basic currency/crypto quotations. Explicit files/artifacts collections with HTML/JS/TS extensions and content/source/code fields are also scanned.

This is a limited grammar, not a universal fact parser, semantic code interpreter or security sandbox. Dynamic code, archives, unsupported formats and multilingual phrasing outside recognized patterns may need separate analysis. Missing detections mean only that no recognized claim was found.

## Security and egress boundary

The gate controls calls routed through callTool(), not arbitrary fetch, node:http, node:net, node:tls or executor child processes. Enforced deny-all-except-gateway egress requires OS/container/network isolation, controlled endpoints and policy auditing. ProofReceipt V2 reports egress_status: NOT_ENFORCED and signature_status: UNAVAILABLE. VERIFIED concerns supported claims and recorded evidence, not all network behavior or truth about the external world.

ToolCallRecord.response contains response data; review redaction and retention before handling private workloads. SHA-256 is not a digital signature. A fully rewritten, unsigned and unanchored bundle can be consistently resealed. The separate [Agent Trust Fabric](./AGENT_TRUST_FABRIC_V0_1.md) and [Devnet Registry](./PROOF_REGISTRY_DEVNET.md) provide additional signed and anchored evidence for configured chat runs, without changing this v1 grammar or enforcing egress.

## Replay

The runtime records TOOL_CALL_STARTED, TOOL_CALL_COMPLETED and CLAIM_ATTRIBUTION_CHECKED. Replay uses that execution's data: claim, response ID/hash or missing source, reason code and final verdict. verifyCompletedMission also checks call/event order for completed missions. Replay does not execute tools again.

## Regression evidence

`tests/source-attribution-22c.test.ts` covers the following original ENFORCE scenarios:

- 22°C and an integration claim without an API call: FAILED / CLAIM_UNSUPPORTED.
- Actual local HTTP response 22°C and report 22°C: VERIFIED.
- HTTP response 22°C and report 25°C: FAILED / CLAIM_VALUE_MISMATCH.
- Ordinary task application with technical numbers: VERIFIED.
- Single HTTP 200 plus completed integration claim: FAILED / CLAIM_UNSUPPORTED.

The false-positive regression also covers current temperature in generated HTML or currentWeather.temperature_celsius in JS without an API source, ordinary HTML/JS/CSS example literals, Bitcoin claims, fabricated executor tool-call evidence and opt-out attempts through Mission.input or final_output. Runtime-owned provenance is required; a hash does not turn executor evidence into a runtime-owned record. Host-only opt-out requires trusted confirmation on independent verification.

These are not network-isolation tests.

## Historical validation — 2026-10-31

The operator reported Windows / Node.js 24.17.0, SHA fc4756f, npm test: 308 tests, 305 PASS, 0 FAIL, 3 SKIP. Dashboard build also completed after the spawnSync npm.cmd EINVAL / DEP0190 correction. These are historical local results, not current CI or live NVIDIA/NeurOSA acceptance. See [dated status and boundaries](./OSA_PROOF_STATUS_2026-10-31.md).
