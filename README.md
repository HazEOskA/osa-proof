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
npm install
npm test
```

See `docs/BACKEND_ARCHITECTURE_LOCK_V1.md`, `apps/web/README.md`, and the contracts under `docs/`.
