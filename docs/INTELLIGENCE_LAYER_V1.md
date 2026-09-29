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
| `llm-gateway` | LIVE | routes by `OSA_PROVIDER` to `anthropic` or `openai`; bounded retries pass |
| `model-mesh` | LIVE | ordered fallback after retries; every hop recorded in evidence |
| `datasets` | LIVE | immutable versions, tags, per-example and per-version sha256 |
| other five | SOON | no implementation |

## LLM Gateway behaviour

Retry rules follow the official OpenAI and Anthropic SDKs:

- Retried: connection errors, timeouts, HTTP 408, 409, 429 and 5xx. `x-should-retry: true|false` overrides the status rule.
- Never retried: other 4xx, incomplete or refused output, invalid response bodies.
- Attempts: `OSA_PROVIDER_MAX_RETRIES + 1` (default 2 retries, allowed 0 to 10).
- Delay: `retry-after-ms` or `retry-after` when present and at most 60 s; otherwise `OSA_PROVIDER_RETRY_BASE_MS × 2^n` (default 500 ms), capped at 8 s, minus up to 25% jitter.
- Every `provider_call` evidence record carries `attempts`. A run that exhausts its retries fails with each attempt's error listed, secrets redacted.

Cross-model fallback is not part of the gateway. It belongs to `model-mesh`.

## Model Mesh behaviour

Follows the LiteLLM fallback pattern: in order, and only after the gateway spent its retries.

- Targets: the primary (`OSA_PROVIDER`, `OSA_MODEL`) then `OSA_MODEL_FALLBACKS="provider:model,provider:model"`, at most 4 fallbacks. Each fallback needs its provider key; duplicates and malformed entries refuse to start.
- A target that fails with a provider error hands over to the next one. Programming errors are never swallowed.
- `provider_call` evidence carries `hops`: every target tried, in order, with `ok`, `attempts` and the redacted error. The `provider` field names the target that served.
- When every target fails, the run is FAILED and the sealed receipt's `runtime_failure` lists each hop.
- Without `OSA_MODEL_FALLBACKS` the single-provider path is unchanged and evidence has no `hops`.

## Datasets behaviour

Follows the LangSmith and Braintrust dataset model, with OSA proof semantics.

- An example is a mission template: `example_id`, `objective`, `input`, `requirements` (at least one), optional `expected.verdict`, `split`, `metadata`.
- Every add, update or delete is a commit that creates a new immutable version. Old versions stay readable. A commit that changes nothing is refused (409).
- Tags (`prod`, `baseline`) point at a version and can be moved. Reads take `as_of` = version number, tag, or `latest`.
- Digests: `example_sha256` per example, `examples_root` over the id-sorted examples, `version_sha256` over the whole version. `GET /datasets/:id/verify` recomputes them; any tampering fails.
- Invalid input is refused whole: no partial commits. At most 10 000 examples per version.
- `missionFromExample` turns a pinned example into a runnable mission with id `<dataset>@v<version>:<example>`.
- Storage is in-memory in the API process, like runs.

```
POST /datasets                          create (201)
GET  /datasets                          latest version summary per dataset
GET  /datasets/:id?as_of=               one version (number, tag or latest)
GET  /datasets/:id/versions             version history with tags
POST /datasets/:id/versions             commit {upsert, remove, message} (201)
PUT  /datasets/:id/tags/:tag            {version} moves or creates a tag
GET  /datasets/:id/verify?as_of=        recompute digests
```
