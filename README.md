# OSA Proof

**The proof layer for AI agents.**

OSA Proof is a proof-first platform for building, running, observing, and verifying agentic systems.

The platform is designed around one invariant:

> **CLAIM != PROOF**

An agent run is not complete because a model says it succeeded. Completion requires evidence, verification, and a proof receipt.

## Product layers

1. **OSA Academy** — visual-first learning for schools, computer clubs, students, and beginners.
2. **OSA Builder / Core** — the primary product: Team Graph, runtime, tools, models, memory, workflows, observability, APR, proof, and deployment adapters.
3. **OSA Regulated** — controlled extensions for enterprise and regulated environments. Access to regulated domain packs is gated by verified organizational affiliation and policy.

All three layers use the same Builder/Core engine. Academy is a constrained learning surface over Core; Regulated is a hardened policy and governance surface over Core.

## Canonical architecture

```text
Visual / 3D Builder ─┐
SDK / CLI ───────────┼──> Team Graph ──> Runtime ──> Evidence ──> APR ──> Proof Receipt
Framework adapters ──┘
```

The **Team Graph** is the canonical representation of an agentic team. The 3D world is a real control surface for that graph, not a decorative simulation.

## Current implementation focus

Vertical Slice #1:

```text
2 agents
→ connect
→ assign mission
→ execute in the real runtime
→ collect evidence
→ verify with APR
→ VERIFIED or FAILED proof receipt
```

No landing page, 3D implementation, deployment, billing, school product, or regulated domain pack is part of the foundation slice.

See `docs/` for the locked contracts.
