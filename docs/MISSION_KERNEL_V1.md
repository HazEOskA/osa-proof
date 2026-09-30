# Mission Kernel — S1

Mission is the operation aggregate. TeamGraph remains the canonical team topology;
the kernel snapshots its version at Mission creation and compiles its existing
acyclic, linear handoff path into a TaskGraph. This is not a cognitive planner or
a second agent runtime.

## Implemented contracts and execution

`packages/contracts/src/mission-kernel.ts` defines MissionState, TaskGraph,
TaskNode, TaskState, OSAEvent, MissionReceipt and MissionRecord. MissionPolicy
allows an executor allowlist; MissionBudget limits the number of planned tasks.
These are opt-in restrictions on a Mission, not platform authorization or
monetary/resource limits.

`MissionKernel.execute()` delegates agent work to OsaRuntime. It persists actual
runtime events and derives task states from AGENT_STARTED/COMPLETED/FAILED.
The lifecycle is CREATED → PLANNED → EXECUTING → VERIFYING → COMPLETED, or FAILED.
CREATED/PLANNED can be CANCELLED. Active cancellation is rejected because current
executors provide no cancellation primitive.

Completion requires a VerificationReceipt (the existing osa.proof_receipt.v2),
receipt/evidence/output integrity and deterministic re-evaluation of the stored
Mission requirements. Completed task states, final timeline, Mission definition,
TaskGraph and the verification digest are bound by osa.mission_receipt.v1.
Repeated execution of a completed Mission checks the receipts and returns the
stored execution without running agents again. Failed/cancelled Missions are
terminal; use a new mission_id for new work. Direct OsaRuntime consumers keep
their existing per-call semantics.

## API and persistence

POST /missions requires an already registered TeamGraph version and validates
the Mission before creating it. Duplicate mission_id returns 409. The existing
POST /missions/:id/run response remains RunResult.

- GET /missions/:id — persisted aggregate, including run, evidence and receipts.
- GET /missions/:id/timeline — OSAEvent projection of actual runtime events.
- GET /missions/:id/run — stored RunResult; 404 before a run exists.
- GET /missions/:id/receipt — MissionReceipt; 404 before verified completion.
- POST /missions/:id/cancel — pre-execution cancellation; 409 for active/terminal work.

All these routes require the existing DEV session, unless the existing explicit
open preview mode is enabled. This slice does not make local-dev authentication
or the existing API production multi-tenant authorization. Organization/project
binding rejects cross-tenant TeamGraph and receipt reuse; HTTP membership and
per-resource permissions still need the security boundary slice.

The Node API server uses MemoryMissionStore by default. Set
`OSA_MISSION_STORE_DIR=.osa-proof/missions` to use FileMissionStore on a persistent
local volume. /build/status reports mission_persistence independently from the
remaining process-memory stores. The Vercel entrypoint remains ephemeral.
Teams, sessions, datasets, evaluators and /runs cache remain process-local;
after restart GET /missions/:id/run reads durable results directly.

FileMissionStore uses hashed filenames (mission IDs cannot traverse directories),
private file permissions, integrity digests, compare-and-swap revisions,
exclusive per-Mission lock files, fsync and atomic rename. Separate processes on
the same local filesystem cannot both claim one revision. There is no distributed
database guarantee. An abandoned lock or EXECUTING/VERIFYING snapshot is left
for operator reconciliation after a crash; automatic re-execution would risk
repeating external side effects. No lease/fencing recovery is claimed.

Digests detect corruption, not an attacker who can rewrite and consistently
reseal all stored records. External anchoring/signatures and independent live
application verification are future proof-plane work. A fixture or provider
artifact receipt does not prove a build, test, deployment or live Azure service.

## Validation and rollout

Run `npm test`. mission-kernel tests cover lifecycle, terminal failure,
runtime exceptions, policy/task budgets, receipt tampering/resealing, foreign
Mission/tenant reuse, cancellation, duplicate execution, filesystem restart,
integrity, safe filenames and concurrent/stale writers. mission-api test covers
HTTP compatibility, auth gates, restart and idempotent execution.

No automatic migration of the old process-memory maps is possible after a restart.
Create new Missions through the kernel; existing TeamGraphs remain valid.
For rollout, enable the persistent directory on a single Node host after local
tests. Reverting the code restores the former API execution path; retain the
snapshot directory as evidence and reconcile active work before switching.

## Next slices

S2 now connects a NeurOSA planning contract to Mission intent and pinned plans;
see [S2 implementation and boundaries](NEUROSA_BRAIN_S2.md).
S3 adds leased workers, multi-sandbox execution and safe recovery/cancellation.
S4 unifies integration capability metadata and benchmark-driven selection.
S5 introduces a provider-neutral deployment contract and a real Azure adapter
with registry, healthcheck and independent live verification.
S6 introduces versioned pipeline products and UI/3D projections of runtime events.
None of those capabilities is claimed by S1.
