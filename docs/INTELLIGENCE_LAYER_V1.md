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
| `evaluators` | LIVE | deterministic or human-labeled only; results sealed and bound to the run's receipt |
| `experiments` | LIVE | dataset version × team version through the real runtime, scored by evaluators, sealed and comparable |
| `knowledge` | LIVE | chunked sources with sha256, deterministic BM25 search, every hit a verifiable citation |
| `memory`, `context-hub` | SOON | `memory` lives in the separate neurosa repo; `context-hub` depends on it |

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

## Evaluators behaviour

Follows the OpenAI graders and LangSmith evaluators model, with OSA proof semantics.

- An evaluator is declarative data, content-addressed by `evaluator_sha256`. Definitions are immutable: the same id with different content is refused (409).
- Deterministic types: `verdict_match` (run verdict vs the example's `expected.verdict`), `receipt_valid`, `string_check` (`eq`, `neq`, `like`, `ilike` on a path in `final_output`), `evidence_equals` (evidence kind, optional agent, field, expected value).
- Labeled type: `human_label` with a fixed scale of `choices` between 0 and 1. A label outside the scale is refused.
- A model judge is a claim, not a proof, and is refused.
- Scores are 0 to 1; `passed` is `score >= pass_threshold` (default 1).
- Every result is an observation with `provenance` `VERIFIER_OBSERVATION` (deterministic) or `HUMAN_LABEL`, bound to the run's `binding`, `proof_id` and `receipt_sha256`, sealed with `observation_sha256`. The run's receipt is never changed.
- Fail closed: when the receipt does not verify, every deterministic evaluator scores 0 and labels are refused.
- A result bound to a dataset example carries `dataset_id`, `version`, `example_id` and `example_sha256`.

```
POST /evaluators                  register a definition (201)
GET  /evaluators                  all definitions
GET  /evaluators/:id              one definition
POST /runs/:id/evaluations        {evaluator_ids, example?: {dataset_id, as_of, example_id}} (201)
POST /runs/:id/labels             {evaluator_id, labeler, score, comment?} (201)
GET  /runs/:id/evaluations        every result for the run
```

## Experiments behaviour

Follows LangSmith and Braintrust experiments, with OSA proof semantics.

- Inputs are pinned by digest: the dataset `version_sha256`, the Team Graph `graph_sha256` and each `evaluator_sha256`.
- Every example runs through the real runtime and gets its own sealed receipt; the experiment keeps `run_id` and `proof_id` per example.
- `outcome_sha256` covers what must repeat (pins, per-example verdicts and scores); `experiment_sha256` covers the whole record.
- `GET /experiments/compare?a=&b=` lists per-example verdict and score changes. Experiments over different dataset versions are refused (409).

```
POST /experiments                 {dataset_id, as_of?, team_id, version, evaluator_ids, split?} (201)
GET  /experiments                 newest first
GET  /experiments/:id             one experiment
GET  /experiments/compare?a=&b=   per-example changes
```

## Knowledge behaviour

- Documents are split into chunks on blank lines (long paragraphs wrap at 800 characters); `chunk_sha256` covers the exact chunk text, `document_sha256` the document.
- Search is lexical BM25 (k1 1.2, b 0.75): deterministic, no model. Each search is sealed with `retrieval_sha256`.
- Every hit carries `doc_id`, chunk index, `chunk_sha256` and `document_sha256`; `verifyCitation` re-checks a quote against the stored document.
- A `doc_id` is immutable: the same id with different text is refused (409).
- Not yet: retrieval results recorded as run evidence.

```
POST /knowledge/:collection/documents   {doc_id, title?, source?, text} (201)
POST /knowledge/:collection/search      {query, k?}
GET  /knowledge                         collections
GET  /knowledge/:collection             documents
GET  /knowledge/:collection/documents/:id
```
