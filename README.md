# OSA Proof

**The proof layer for AI agents.**

OSA Proof is a proof-first platform for building, running, observing, and verifying agentic systems.

> **CLAIM != PROOF**

An agent run is not complete because a model says it succeeded. Completion requires evidence, verification, and a proof receipt.

## Product layers

1. **OSA Academy** — visual-first learning for schools, computer clubs, students, and beginners.
2. **OSA Builder / Core** — the primary product: Team Graph, runtime, tools, models, memory, workflows, observability, APR, proof, and deployment adapters.
3. **OSA Regulated** — controlled extensions for enterprise and regulated environments, enabled only after organizational/affiliation verification and policy approval.

All layers share the same Core. Academy constrains it; Regulated hardens it.

## Canonical backend

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

Implemented scope:

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

Minimal HTTP boundary exposes teams, missions, runs, events, evidence, and proof.

## Local verification

```bash
npm install
npm test
```

The repository intentionally contains no frontend, 3D implementation, deployment, billing, Academy implementation, or Regulated domain pack in this slice.

See `docs/BACKEND_ARCHITECTURE_LOCK_V1.md` and the other contracts under `docs/`.
