# Team Graph Contract v1

The Team Graph is the canonical representation of an executable agentic team.

## Required concepts

### Team

A Team has:

- stable `team_id`,
- version,
- agents,
- edges,
- mission configuration,
- policy references,
- proof requirements.

### Agent node

An Agent node declares:

- stable `agent_id`,
- role,
- model reference,
- tool capabilities,
- memory reference,
- policy reference,
- input/output contract.

### Edge

An Edge declares a permitted relationship between nodes, for example:

- delegation,
- handoff,
- review,
- verification,
- data flow.

An edge is executable configuration, not visual decoration.

### Mission

A Mission declares:

- mission ID,
- objective,
- inputs,
- acceptance requirements,
- proof policy,
- execution limits.

## Canonical rule

```text
3D Scene != source of truth
SDK Object != source of truth
Imported Framework Object != source of truth

Team Graph = source of truth
```

Every supported surface must be able to produce or consume a Team Graph representation.

## Runtime projection

The runtime consumes a versioned Team Graph and emits events that identify:

- mission,
- team version,
- agent,
- action,
- tool/model call,
- state transition,
- evidence reference,
- timestamp/order.

The world/control-plane layer may visualize these events but may not invent execution state.

## Foundation schema target

Vertical Slice #1 requires only enough schema to represent:

- two agents,
- one directed relationship,
- one mission,
- proof requirements,
- execution state.

Additional graph semantics are postponed until after the first slice is verified.
