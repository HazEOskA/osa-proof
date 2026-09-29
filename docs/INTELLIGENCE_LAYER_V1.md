# Intelligence Layer v1

Nine modules, one rule: **a module's status is computed from proof, never declared.**

## Modules

| Module | Depends on | Required proofs |
|---|---|---|
| `models` | — | `config.fails_closed`, `models.lists_configured`, `provider.rejects_unknown` |
| `llm-gateway` | models | `config.fails_closed`, `errors.redact_secrets`, `routing.multi_provider`, `calls.bounded_retries` |
| `model-mesh` | llm-gateway | `mesh.fallback_on_failure`, `mesh.evidence_per_hop` |
| `memory` | — | `memory.scoped_to_execution`, `memory.writes_are_evidence` |
| `knowledge` | — | `knowledge.sources_cited`, `knowledge.content_digests` |
| `context-hub` | memory, knowledge | `context.assembly_deterministic`, `context.budget_enforced` |
| `datasets` | — | `datasets.versioned`, `datasets.content_digests` |
| `evaluators` | — | `evaluators.deterministic_or_labeled`, `evaluators.results_as_observations` |
| `experiments` | datasets, evaluators | `experiments.reproducible`, `experiments.receipts_compared` |

## Status rules

1. The catalog in `packages/intelligence/src/index.ts` is the only list of modules. Unknown or duplicate registrations are refused.
2. No implementation registered: `SOON`.
3. Implementation registered: `PREVIEW` until every required proof passes.
4. `LIVE` only when every required proof passes **and** every dependency is `LIVE`. `blocked_by` names the dependencies that are not.
5. A missing check, a check returning anything but `ok: true`, or a check that throws is a failed proof (fail closed).
6. Every report carries `report_sha256` over its canonical body. The UI reads reports from the API and never sets a status.

Built-in checks use fixed sample inputs. They never read the process environment or real secrets.

## Adding a module

1. Implement the capability.
2. Register a `ModuleImplementation` with one `ReadinessCheck` per required proof id.
3. Add tests that make each check pass for the right reason and fail for the wrong one.
4. The status moves by itself. Do not edit the catalog to move a status.

## API

```text
GET /intelligence        all nine reports
GET /intelligence/:id    one report, 404 for unknown ids
```

## State at v1

| Module | Status | Why |
|---|---|---|
| `models` | LIVE | all three proofs pass |
| `llm-gateway` | PREVIEW | `routing.multi_provider` (only `anthropic`), `calls.bounded_retries` (single attempt) fail |
| other seven | SOON | no implementation |
