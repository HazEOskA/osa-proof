# Architecture Lock v1

Status: **LOCKED FOUNDATION**
Scope: product architecture and contracts only.

## Goal

Build OSA Proof as a proof-first Agentic Systems Builder with one shared Core and three product layers:

- OSA Academy
- OSA Builder / Core
- OSA Regulated

The current execution priority is **Builder / Core**.

## Core pipeline

```text
Input Surface
    |
    v
Team Graph
    |
    v
Runtime
    |
    v
Evidence Collector
    |
    v
APR Verifier
    |
    v
Proof Receipt
```

### Input surfaces

A team may be created from:

- visual/3D builder,
- SDK,
- CLI,
- imported/external framework adapter.

Every input surface MUST compile or translate into the same Team Graph contract.

## Architectural invariants

1. **Team Graph is canonical.**
   UI state, 3D scene state, SDK objects, and framework imports are projections or producers of Team Graph state.

2. **3D is operational, not decorative.**
   A connection made in the world must change the executable Team Graph. A runtime event must be able to project back into the world.

3. **Proof is part of execution.**
   APR is not an optional analytics plugin. A proof-required mission cannot become VERIFIED without evidence and verification.

4. **CLAIM != PROOF.**
   Model text, agent self-reporting, or UI success state cannot independently satisfy completion.

5. **One Core, multiple product layers.**
   Academy and Regulated reuse Core. They do not fork the runtime.

6. **Framework neutral boundary.**
   External systems such as LangGraph, CrewAI, Mastra, OpenAI Agents, MCP-based systems, and custom runtimes may connect through adapters without changing the Proof Protocol.

7. **Policy is enforced below the UI.**
   UI controls may explain or request actions, but runtime/policy enforcement is authoritative.

8. **No fake completion.**
   The UI may display RUNNING, FAILED, INCOMPLETE, or VERIFIED only from runtime/proof state.

## Core modules

- `packages/team-graph` — canonical agent/team representation.
- `packages/runtime` — mission execution and runtime state.
- `packages/proof-core` — evidence, verification, proof receipts.
- `packages/sdk` — programmatic public API.
- `packages/cli` — developer command surface.
- `packages/adapters` — framework/provider/runtime adapters.
- `packages/agent-registry` — agent definitions and capabilities.
- `packages/world-protocol` — bidirectional contract between visual world and Team Graph/runtime events.
- `packages/access-control` — entitlement and access boundary definitions.
- `packages/policy-engine` — enforceable policy contracts.

## Explicit non-goals for foundation

- 3D UI implementation,
- landing page,
- hosted control plane,
- billing,
- cloud deployment,
- school classroom product,
- finance/defense domain packs,
- production identity or organization verification.

Those capabilities are planned by contract only and require separate approval before implementation.
