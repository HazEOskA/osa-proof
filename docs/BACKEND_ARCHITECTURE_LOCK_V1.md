# Backend Architecture Lock v1

Status: **LOCKED FOR VERTICAL SLICE #1**

## Goal

Build only the backend loop required to prove that a two-agent Team Graph executes real code, produces runtime evidence, and cannot return VERIFIED without deterministic verification.

## Pipeline

```text
Team Graph
  -> Mission
  -> Runtime
  -> Executor Registry
  -> Event Store
  -> Evidence Collector
  -> Deterministic APR Verifier
  -> Proof Receipt
```

## Modules in this slice

- `packages/contracts` — shared backend contracts.
- `packages/team-graph` — validation and Slice #1 linear handoff traversal.
- `packages/runtime` — execution engine and executor registry.
- `packages/events` — runtime event interface plus memory and JSONL stores.
- `packages/evidence` — evidence collector.
- `packages/proof-core` — deterministic acceptance verification and proof receipts.
- `apps/api` — minimal HTTP boundary for teams, missions, runs, events, evidence, and proof.
- `tests` — success, failure, incomplete, persistence, graph validation, and HTTP acceptance coverage.

## Invariants

1. Team Graph remains the canonical executable representation.
2. Runtime state is not inferred from UI state.
3. Every event and evidence record is correlated by `run_id`.
4. `organization_id`, `project_id`, `team_id`, `team_version`, and `mission_id` travel through runtime evidence and proof.
5. Agent executors are registered behind an executor boundary; the runtime does not depend on a specific model provider.
6. Slice #1 supports an acyclic linear handoff only. Branching, loops, schedulers, memory, model routing, and tool sandboxes are intentionally postponed.
7. `VERIFIED` is created only by deterministic evidence evaluation.
8. Model/agent text is never sufficient evidence by itself.
9. Runtime events can be persisted using the JSONL event-store adapter.
10. API is a client boundary only; business truth lives below it.

## Minimal HTTP surface

```text
POST /teams
GET  /teams/:id?version=:version
POST /missions
POST /missions/:id/run
GET  /runs/:id
GET  /runs/:id/events
GET  /runs/:id/evidence
GET  /runs/:id/proof
```

## Explicit non-goals

No frontend, 3D world, landing page, deployment, cloud integration, authentication, billing, Academy implementation, Regulated implementation, model router, memory system, multi-framework adapters, or production database is included in this slice.
