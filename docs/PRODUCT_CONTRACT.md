# Product Contract

## Product

**OSA Proof Platform**

Positioning:

> **The proof layer for AI agents. Build agentic teams that can prove their work.**

## Layer 1 — OSA Academy

Audience:

- schools,
- computer clubs,
- students,
- beginners,
- teachers.

Contract:

- visual-first learning,
- safe/constrained tools,
- guided missions,
- reusable team templates,
- teacher-oriented assignment/progress surfaces,
- same Team Graph and proof engine as Core.

Academy MUST NOT introduce a separate toy runtime.

## Layer 2 — OSA Builder / Core

Primary product and current implementation focus.

Capabilities planned around the Core:

- agent/team composition,
- Team Graph,
- models,
- tools,
- memory,
- workflows,
- multi-agent execution,
- visual/3D world,
- SDK/CLI,
- external framework adapters,
- observability,
- APR verification,
- proof receipts,
- deployment adapters.

Builder/Core is the source platform used by Academy and Regulated.

## Layer 3 — OSA Regulated

Audience:

- verified enterprises,
- finance,
- defense,
- government,
- healthcare,
- industrial and critical environments.

Contract:

- access is not self-asserted,
- gated capabilities require verified organization/affiliation,
- domain packs extend policy/governance and deployment constraints,
- regulated capabilities remain disabled unless entitlement is verified.

Possible domain-pack capabilities include:

- stricter policy sets,
- model/tool allowlists,
- audit controls,
- retention rules,
- deployment boundaries,
- stronger isolation,
- organization-specific governance.

No regulated domain implementation is included in the foundation slice.

## User entry paths

### Build with OSA

```text
Visual / SDK / CLI
→ Team Graph
→ Runtime
→ APR
→ Proof
```

### Connect OSA

```text
Existing agent framework/runtime
→ adapter
→ OSA evidence/proof boundary
→ APR
→ Proof
```

A user does not have to abandon an existing framework to use the proof layer.
