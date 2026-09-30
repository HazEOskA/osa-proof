# OSA Proof

**The proof layer for AI agents.**

OSA Proof is a proof-first platform for building, running, observing, and verifying agentic systems.

> **CLAIM != PROOF**

An agent run is not complete because a model says it succeeded. Completion requires evidence, verification, and a proof receipt.

## Product layers

1. **OSA Academy / SCHOOL** — visual-first learning for schools, computer clubs, students, and beginners.
2. **OSA Builder / DEV** — the primary product: Team Graph, runtime, tools, models, memory, workflows, observability, APR, proof, and deployment adapters.
3. **OSA Regulated** — controlled entry points for BANK, FINANCIAL, CYBERSECURITY, and ARMY environments.

All layers share the same Core. Academy constrains it; Regulated hardens it.

## Entry control

The approved **Choose Your Layer** screen is wired to the backend before navigation:

```text
Selector
    -> POST /layers/:id/enter
    -> ALLOWED -> SCHOOL / DEV surface
    -> GATED   -> regulated access boundary
```

Regulated layers fail closed. Browser state or self-asserted flags cannot unlock regulated capability. Until organization / affiliation / entitlement verification exists, the backend exposes only the regulated gate surface.

## Canonical execution backend

```text
Input Surface
    -> Team Graph
    -> Mission
    -> Runtime
    -> Event Stream
    -> Evidence
    -> APR Verifier
    -> Proof Receipt
```

The **Team Graph** is the source of truth. A future 3D world is an operational control surface over this graph, not a decorative simulation.

## Backend Vertical Slice #1

Implemented:

```text
2 agents
-> executable handoff
-> mission
-> runtime execution
-> persisted runtime events
-> evidence collection
-> deterministic verification
-> VERIFIED / FAILED / INCOMPLETE proof receipt
```

HTTP additionally exposes the product-layer catalog and backend-authoritative layer entry decisions.

## Local verification

Mission lifecycle, durable snapshots, timeline and receipt-gated completion are
available through the [S1 Mission Kernel](docs/MISSION_KERNEL_V1.md). The kernel
reuses TeamGraph, OsaRuntime and the deterministic proof verifier.

[S2 NeurOSA Brain](docs/NEUROSA_BRAIN_S2.md) adds validated planning before
execution, pinned instructions, planning/decision receipts, optional NeurOSA
memory context and proof-derived reflection. Set `OSA_BRAIN_MODE=model` with the
existing provider configuration to enable model-backed planning.

```bash
npm ci
npm test
```

## Execution modes

The API server requires an explicit execution mode. There is no default; a missing or
unknown value refuses to start.

```bash
# Deterministic, offline
OSA_EXECUTION_MODE=fixture npm start

# Real provider-backed execution (Anthropic Messages API)
OSA_EXECUTION_MODE=provider \
OSA_PROVIDER=anthropic \
OSA_MODEL=<model id> \
ANTHROPIC_API_KEY=<secret> \
npm start
```

`OSA_PROVIDER` is `anthropic` (key in `ANTHROPIC_API_KEY`) or `openai` (key in `OPENAI_API_KEY`).

Optional: `OSA_PROVIDER_BASE_URL`, `OSA_PROVIDER_TIMEOUT_MS` (default 120000),
`OSA_PROVIDER_MAX_TOKENS` (default 16000), `OSA_PROVIDER_MAX_RETRIES` (default 2),
`OSA_PROVIDER_RETRY_BASE_MS` (default 500), `OSA_MODEL_FALLBACKS` (ordered `provider:model` list
for the model mesh). `OSA_AUTH_MODE` is `session` (default: DEV login required for
teams, missions and runs) or `open` (no login; set only for the Vercel preview in `vercel.json`). Retries follow the official SDK rules; see
`docs/INTELLIGENCE_LAYER_V1.md`.

Team Graphs reference only the stable executor refs `dev.planner.v1` and `dev.builder.v1`;
the server registers the fixture or provider implementation under them. The provider sits
behind `ModelProvider` in `packages/adapters`, so the runtime and proof core stay provider-neutral.

Datasets (`packages/datasets`, `/datasets` routes) hold versioned mission examples: every change is a
new immutable version with sha256 digests, tags pin versions. See `docs/INTELLIGENCE_LAYER_V1.md`.
Evaluators (`packages/evaluators`, `/evaluators` and `/runs/:id/evaluations` routes) score runs with
deterministic checks or human labels; each result is a sealed observation bound to the run's receipt.
Experiments (`packages/experiments`, `/experiments` routes) run a pinned dataset version against one Team
Graph version through the runtime, score each run with evaluators and seal the outcome; two experiments
on the same dataset version can be compared example by example. Knowledge (`packages/knowledge`,
`/knowledge` routes) chunks sources with sha256 and searches them with deterministic BM25; every hit
cites a chunk anyone can re-hash.

## Control plane

`packages/control` holds the control plane; state is process memory, like runs.

- Deployments (`/deployments`): pin a Team Graph version by `graph_sha256` to `preview` or `production`;
  one ACTIVE per team and environment; promote, rollback; runs through a deployment use the pinned graph.
- Policies (`/policies`): rules checked before a deployment runs a mission; a failing enabled policy
  refuses the run with 403 `POLICY_DENIED`.
- Queue and scheduler (`/queue`): missions queued now or at `run_at`; due jobs run on `POST /queue/drain`
  (no background worker on serverless).
- Organizations, secret status (names only, never values) and the route-by-route permission table.

## Dashboard and Vercel

`vercel.json` builds the dashboard (`scripts/build-dashboard.cjs`, source in `dashboard-src`) into
`dashboard-dist`, copies the docs to `/docs`, and routes every API path to one function, `api/osa.ts`,
so all routes share one process state. The preview runs with `OSA_EXECUTION_MODE=fixture` and
`OSA_AUTH_MODE=open`; no model is called and no key is configured there.

Provider evidence is computed by executor code, never copied from model text:
`provider_call` (status, model, response id, usage, request/response hashes) and
`artifact` with `status: "built"`, `content_sha256` and `bytes`. `built` means the provider
call completed, the response parsed and passed the structural contract, and non-empty
content was hashed. It does not assert quality or semantic correctness.

Opt-in live check: `OSA_LIVE_PROVIDER_TEST=1` plus the provider variables above, then `npm test`.

See `docs/BACKEND_ARCHITECTURE_LOCK_V1.md`, `apps/web/README.md`, and the contracts under `docs/`.
