# S2 — NeurOSA cognitive control-plane integration

Implemented in osa-proof on top of S1. One Mission Kernel, canonical TeamGraph,
existing OsaRuntime and deterministic verifier remain authoritative. No second
agent runtime or copy of the NeurOSA storage/activation implementation is added.

## Existing code reused and upstream boundary

- `packages/adapters/src/provider.ts`, `config.ts`, `mesh.ts`, `retry.ts`:
  provider-neutral ModelProvider, configured model routing, retries and fallback evidence.
- `packages/adapters/src/executors.ts`: existing agent planner/builder consume
  pinned Brain instructions alongside their existing input/handoff contracts.
- S1 MissionStore, lifecycle, event timeline, receipt verifier and TeamGraph compiler.
- NeurOSA-HB at audited commit
  `a29b973d4c67c238c2e5818d7e65ad3ed3e0c52d`:
  [BrainApiServer.route](https://github.com/HazEOskA/neurosa-human-brain/blob/a29b973d4c67c238c2e5818d7e65ad3ed3e0c52d/packages/neurosa-brain-api/src/index.ts)
  implements GET `/api/v1/brain/status` and POST `/api/v1/brain/recall`.
  [NeurosaConnect.status/recall](https://github.com/HazEOskA/neurosa-human-brain/blob/a29b973d4c67c238c2e5818d7e65ad3ed3e0c52d/packages/neurosa-connect/src/index.ts)
  establishes origin/credential/brain-id/ledger checks and bounded context semantics.
  Those routes supply memory context, not an executable Mission plan. The new
  adapter uses the real v1 wire contract; it does not invent a remote planner endpoint.

## Contracts, execution and receipts

`packages/contracts/src/brain.ts` defines BrainScope, BrainWorldState,
BrainMemoryContext, BrainPlanner, BrainMemory, MissionPlan, PlanningReceipt,
DecisionReceipt and BrainReflection. Organization, project and mission IDs are
bound throughout. Remote memory requests also carry the encoded mission ID in
`x-osa-mission-id`, plus a scope digest as the upstream correlation ID. The
upstream service does not currently persist that Mission header in its ledger.

Flow:

```text
CREATED Mission + pinned TeamGraph + actual pending task states
  -> durable CAS planning claim
  -> validate executor/model policy and task/context budgets
  -> optional NeurOSA status + bounded recall
  -> native compiler or model planner via existing gateway
  -> strict proposal validation against canonical task/agent order
  -> code derives execution/model/framework decisions from pinned TeamGraph
  -> PlanningReceipt + DecisionReceipts + MissionPlan atomically stored as PLANNED
  -> existing OsaRuntime receives isolated plan/Mission/agent copies
  -> actual execution proof
  -> deterministic reflection from requirement verdicts
  -> MissionReceipt seals planning, decisions, reflection and final execution proof
```

Plan JSON may supply only summary, explicit goals and instructions for the given
task/agent IDs in their existing order. Unknown fields, extra/missing/reordered
tasks and injected executor/dependency/requirement fields are rejected. The model
cannot grant capabilities or weaken Mission acceptance. TaskGraph remains linear
because that is the current runtime's execution contract; multi-sandbox/DAG work
belongs to S3.

PlanningReceipt ACCEPTED means the proposal passed structural, binding, policy
and budget checks. It does not prove semantic feasibility, quality, execution,
testing or deployment. `risk: UNASSESSED` is explicit. DecisionReceipt records a
selection from a pinned graph, not proof a declared tool capability is installed.
Agent model_ref is still declared TeamGraph metadata; executor-internal provider
routing and permissions require execution/integration-plane enforcement. The
Brain model allowlist checks every configured primary/fallback before any call.

World State snapshots actual CREATED/pending Mission tasks and the team version.
It does not invent cloud, sandbox or fleet state. BrainReflection binds the actual
execution proof, failed/incomplete requirement IDs and NONE/REVIEW_REQUIRED
recovery. Reflections persist as learning inputs; no adaptive routing or model
training is claimed.

## API and configuration

- POST `/missions/:id/plan`: plan a CREATED Mission; repeated calls on a valid
  PLANNED Mission return its stored plan without new memory/model calls.
- GET `/missions/:id/plan`: validated BrainPlanResult including receipts, context
  snapshot and reflection where available; 404 before an accepted plan exists.
- POST `/missions/:id/run`: automatically plans a CREATED Mission before execution.
- GET `/build/status`: reports the configured Brain mode, model refs and memory adapter.

Existing DEV auth/open-preview semantics apply. This is not production tenant
membership authorization. Node and Vercel entrypoints both wire the configured
Brain; Vercel remains process-memory persistence.

`OSA_BRAIN_MODE=native` is the compatibility default. It honestly compiles the
existing graph, with the objective as its goal, and makes no model call.
`OSA_BRAIN_MODE=model` requires `OSA_EXECUTION_MODE=provider` and the existing
provider/model configuration. It shares the configured ModelProvider/ModelMesh
and retry policy. Brain planning adds a model call before the existing team
planner and builder; it does not bypass configured agents.

Optional NeurOSA memory requires **all** of:

```text
OSA_NEUROSA_BASE_URL             root origin, remote HTTPS or localhost HTTP
OSA_NEUROSA_TOKEN                server-side token, minimum 24 characters
OSA_NEUROSA_BRAIN_ID             expected canonical upstream brain ID
OSA_NEUROSA_ORGANIZATION_ID      one allowed organization
OSA_NEUROSA_PROJECT_ID           one allowed project
```

Use a dedicated upstream brain for that org/project and a credential with
`brain:read` and `memory:read`. NeurOSA recall is global to its brain: this adapter
cannot establish upstream tenant isolation or filter mixed-tenant documents.
It refuses another org/project before network access. Its credential binding
and the dedicated deployment must be enforced by the operator.

No upstream remember/observe/session writes run in S2. Local Mission records
retain context and proof-derived reflection. Credentials/origins are excluded
from the Brain status, plan receipts and errors. Context may contain sensitive
project data, so its persisted Mission snapshot needs the same access protection.
NeurOSA ledgerValid is server-reported over the authenticated transport, not an
independently anchored ledger proof; neither source authenticity nor truth of
memory text follows from a content digest.

Limits: proposal 128 KiB, summary 4096 chars, 1–32 goals, instruction 8192 chars;
pre-recall request 512 KiB, total context request 1 MiB. NeurOSA responses are
capped at 1 MiB, redirected requests are refused and each request has a 15-second
timeout. Model timeouts/retries use the existing gateway configuration.
MissionBudget.max_context_chars is optional, default 12000, allowed 512–64000.
There is no monetary budget enforcement in this slice.

## Events, concurrency and migration

BRAIN_PLANNING_STARTED, BRAIN_PLAN_ACCEPTED, BRAIN_DECISION_RECORDED,
BRAIN_PLAN_REJECTED and BRAIN_REFLECTED use the S1 OSAEvent timeline with Mission
correlation and receipt evidence refs. Planning and execution claims use Mission
revision CAS before side effects. RUNNING planning survives a crash and refuses
automatic re-entry; operator reconciliation is needed before another costly call.
Active planning cancellation is rejected because no abort primitive exists in
the shared ModelProvider interface. A rejected plan remains CREATED and can be
explicitly retried; it has no execution or success receipt.

Accepted plans are immutable through the API. A changed objective/team version
requires a new Mission. Already completed S1 records without Brain fields retain
their old receipt verification path. CREATED S1 records can be planned in S2;
an unresolved legacy PLANNED record without a plan fails closed. No bulk migration
or automatic replay of active work is performed. Optional fields extend the S1
record/receipt contracts without discarding legacy evidence.

For rollback, stop/reconcile active planning, revert S2 and retain snapshots as
evidence. S1 cannot validate the added Brain portion of a completed MissionReceipt;
use S2's verifier to review that evidence, and avoid replaying accepted plans with
an older kernel. No cloud deployment/configuration has been performed by this slice.

## Capability boundary after S2

| Capability | Status and concrete implementation |
|---|---|
| Intent / Goal decomposition | PARTIAL: ModelBrainPlanner produces validated summaries/goals, semantics remain unproved |
| Planner | EXISTS: BrainControlPlane + verifyBrainPlan, pinned linear tasks |
| Reasoning | PARTIAL: model-backed planning, explicit outputs rather than a separate reasoning engine |
| Memory | PARTIAL: NeurosaMemoryAdapter recall + Mission context/reflection persistence |
| World State | PARTIAL: actual Mission/task/team snapshot, no fleet/cloud world state |
| Reflection | EXISTS: reflectOnExecution derives and seals actual proof verdicts |
| Failure Recovery | PARTIAL: explicit rejected-plan retry, review-required execution failures |
| Policy | PARTIAL: executor/Brain-model allowlists and task/context budgets |
| Risk | MISSING: UNASSESSED, no invented risk scoring |
| Model Router | EXISTS: configured gateway mesh, retries, fallback-hop evidence |
| Agent/Tool/Framework Router | PARTIAL: pinned graph decisions and existing integration router, no capability discovery/adapter lifecycle |
| Cloud / Benchmark Router | MISSING: S4/S5 contracts and routing data still required |
| Learning Loop | PARTIAL: receipt-bound persisted reflections, no adaptive update |

## Validation

`npm test` runs existing regression plus brain.test.ts and brain-api.test.ts.
The S2 HTTP test uses local stubs implementing the audited NeurOSA wire contract
and real OpenAI gateway code, then restarts the API between planning and execution.
It verifies plan reuse, pinned agent inputs, actual runtime evidence, receipts and
reflection. No live NeurOSA or paid provider endpoint was called by these tests.
Security cases cover graph/capability/requirement injection, foreign scope,
fallback allowlists, invalid/oversized context, timeout, redacted errors, planning
CAS/restart, receipt tampering and isolation from executor mutations.
