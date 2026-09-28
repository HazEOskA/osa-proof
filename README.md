# OSA Proof

**The proof layer for AI agents.**

OSA Proof is a proof-first platform for building, running, observing, and verifying agentic systems.

> **CLAIM != PROOF**

An agent run is not complete because a model says it succeeded. Completion requires evidence, verification, and a proof receipt.

## Product layers

1. **OSA Academy / SCHOOL** — visual-first learning for schools, computer clubs, students, and beginners.
2. **OSA Builder / DEV** — the primary product: Team Graph, runtime, tools, models, memory, workflows, observability, APR, proof, and deployment adapters.
3. **OSA Regulated** — controlled entry points for BANK, FINANCIAL, CYBERSECURITY, and ARMY environments.

All layers share the same Core. Academy constrains it; Regulated hardens it.

## Entry control

The approved **Choose Your Layer** screen is wired to the backend before navigation:

```text
Selector
    -> POST /layers/:id/enter
    -> ALLOWED -> SCHOOL / DEV surface
    -> GATED   -> regulated access boundary
```

Regulated layers fail closed. Browser state or self-asserted flags cannot unlock regulated capability. Until organization / affiliation / entitlement verification exists, the backend exposes only the regulated gate surface.

## Canonical execution backend

```text
Input Surface
    -> Team Graph
    -> Mission
    -> Runtime
    -> Event Stream
    -> Evidence
    -> APR Verifier
    -> Proof Receipt
```

The **Team Graph** is the source of truth. A future 3D world is an operational control surface over this graph, not a decorative simulation.

## Backend Vertical Slice #1

Implemented:

```text
2 agents
-> executable handoff
-> mission
-> runtime execution
-> persisted runtime events
-> evidence collection
-> deterministic verification
-> VERIFIED / FAILED / INCOMPLETE proof receipt
```

HTTP additionally exposes the product-layer catalog and backend-authoritative layer entry decisions.

## Local verification

```bash
npm ci
npm test
```

## Execution modes

The API server requires an explicit execution mode. There is no default; a missing or
unknown value refuses to start.

```bash
# Deterministic, offline
OSA_EXECUTION_MODE=fixture npm start

# Real provider-backed execution (Anthropic Messages API)
OSA_EXECUTION_MODE=provider \
OSA_PROVIDER=anthropic \
OSA_MODEL=<model id> \
ANTHROPIC_API_KEY=<secret> \
npm start
```

Optional: `OSA_PROVIDER_BASE_URL`, `OSA_PROVIDER_TIMEOUT_MS` (default 120000),
`OSA_PROVIDER_MAX_TOKENS` (default 16000).

Team Graphs reference only the stable executor refs `dev.planner.v1` and `dev.builder.v1`;
the server registers the fixture or provider implementation under them. The provider sits
behind `ModelProvider` in `packages/adapters`, so the runtime and proof core stay provider-neutral.

Provider evidence is computed by executor code, never copied from model text:
`provider_call` (status, model, response id, usage, request/response hashes) and
`artifact` with `status: "built"`, `content_sha256` and `bytes`. `built` means the provider
call completed, the response parsed and passed the structural contract, and non-empty
content was hashed. It does not assert quality or semantic correctness.

Opt-in live check: `OSA_LIVE_PROVIDER_TEST=1` plus the provider variables above, then `npm test`.

See `docs/BACKEND_ARCHITECTURE_LOCK_V1.md`, `apps/web/README.md`, and the contracts under `docs/`.
