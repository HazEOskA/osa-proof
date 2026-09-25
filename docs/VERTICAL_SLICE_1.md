# Vertical Slice #1

## Goal

Prove the smallest end-to-end OSA Builder/Core loop.

```text
2 agents
→ connect
→ assign mission
→ run in real runtime
→ collect evidence
→ APR verify
→ proof receipt
```

## Required flow

1. Define Agent A.
2. Define Agent B.
3. Create one executable edge between them.
4. Persist/construct a versioned Team Graph.
5. Submit one mission with an explicit acceptance requirement.
6. Execute the graph in the real runtime.
7. Emit runtime/evidence records.
8. Verify the acceptance requirement.
9. Produce a proof receipt.
10. Return `VERIFIED`, `FAILED`, or `INCOMPLETE`.

## Definition of Done

The slice is complete only when evidence demonstrates:

- the two-agent Team Graph is real executable state,
- the relationship changes execution behavior,
- at least one evidence record originates from actual runtime/tool execution,
- the verifier evaluates an explicit requirement,
- VERIFIED cannot be produced by agent text alone,
- a machine-readable proof receipt is generated,
- a failed acceptance requirement produces a non-VERIFIED result,
- the same scenario can be rerun locally.

## Explicitly excluded

- 3D implementation,
- landing page,
- hosted SaaS,
- billing,
- classroom management,
- regulated domain packs,
- cloud deployment,
- broad multi-framework compatibility.

Those follow after Slice #1 proof.
