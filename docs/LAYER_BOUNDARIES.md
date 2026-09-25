# Product Layer Boundaries

## Shared Core rule

Academy, Builder, and Regulated MUST share:

- Team Graph contract,
- runtime semantics,
- proof protocol,
- evidence model.

They may differ in UI, entitlements, allowed tools/models, policies, and governance.

## Academy boundary

Academy may add:

- guided lessons,
- class/teacher concepts,
- safe presets,
- simplified visual composition,
- constrained execution,
- student progress.

Academy may restrict Core capabilities but must not create a separate execution engine.

## Builder/Core boundary

Builder/Core owns:

- canonical Team Graph,
- runtime,
- proof,
- SDK/CLI,
- adapters,
- agent registry,
- world protocol,
- observability contracts,
- deployment adapter contracts.

This is the only implementation priority for the current phase.

## Regulated boundary

Regulated may add hardened policies and domain packs.

Regulated access model:

```text
request access
→ verify organization
→ verify affiliation/entitlement
→ accept required policy/contract
→ administrative approval
→ enable regulated capability
```

The foundation does not implement identity verification or domain packs.

## Safety and product integrity

Regulated status must never be granted from a self-declared UI field alone.
Access enforcement must occur in backend/runtime policy boundaries, not only in frontend presentation.
