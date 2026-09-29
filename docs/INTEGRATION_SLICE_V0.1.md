# Integration Slice V0.1

Status: implementation branch only. No merge to `main`, no production deploy.

## Goal

Wire existing OSA components behind the canonical `osa-proof` runtime without rewriting them:

```text
Dashboard
  -> Team Graph / Mission
  -> OSA Runtime
  -> deterministic capability router
       BUILD_CODE       -> Coding Agent Platform
       RUN_TOOL         -> OSA Execution Force Runtime V2
       AUTONOMOUS_CYCLE -> OSA Agent command center (/api/control)
       FLEET_CHAT       -> OSA Agent Fleet control plane (/api/chat)
       AGENT_TASK       -> existing native DEV executor
       VERIFY           -> existing native DEV executor -> canonical OSA Proof verifier
  -> Events
  -> Evidence
  -> ProofReceipt v2
  -> Dashboard
```

The router replaces no core component. It is installed under the existing stable
`dev.builder.v1` executor ref only when `OSA_INTEGRATION_ENABLED=1`.

## Deterministic routing

Explicit mission input wins:

```json
{
  "capability": "BUILD_CODE"
}
```

Supported values:

- `BUILD_CODE`
- `RUN_TOOL`
- `AGENT_TASK`
- `VERIFY`
- `AUTONOMOUS_CYCLE`
- `FLEET_CHAT`

Without an explicit capability, V0.1 uses a small deterministic Polish/English
keyword classifier. There is no model call inside the router.

## Coding Agent Platform bridge

The existing `POST /api/tasks` and `GET /api/tasks/:taskId` endpoints accept
the normal user session exactly as before. On the integration branch they also
accept a machine request when all of the following are configured in
`coding-agent-platform`:

```text
OSA_FRAMEWORK_BRIDGE_TOKEN=<strong shared secret>
OSA_FRAMEWORK_USER_ID=<existing internal user id>
OSA_FRAMEWORK_GITHUB_TOKEN=<optional GitHub token for builder repo access>
```

The service bridge is fail-closed. A bearer token is accepted only when both the
bridge token and service user id are configured.

OSA Proof side:

```text
OSA_BUILDER_BASE_URL=https://<coding-agent-platform>
OSA_BUILDER_BRIDGE_TOKEN=<same shared secret>
OSA_BUILDER_DEFAULT_REPO_URL=https://github.com/<owner>/<repo>   # optional
OSA_BUILDER_AGENT=claude                                        # optional
OSA_BUILDER_MODEL=<model>                                       # optional
OSA_BUILDER_POLL_INTERVAL_MS=1000                               # optional
OSA_BUILDER_TIMEOUT_MS=600000                                   # optional
```

The adapter creates a real builder task, polls the existing task endpoint until
terminal state, and emits proof-bound evidence. It does not claim `built` unless
the existing builder reports `completed`.

## OSA Execution Force bridge

OSA Proof side:

```text
OSA_EXECUTION_FORCE_BASE_URL=https://<execution-force>
OSA_EXECUTION_FORCE_API_KEY=<OSA_ACTIONS_API_KEY>
OSA_EXECUTION_FORCE_ENVIRONMENT=development
OSA_EXECUTION_FORCE_TIMEOUT_MS=120000
```

The adapter calls the existing:

```text
POST /api/v2/missions/run
Authorization: Bearer <OSA_ACTIONS_API_KEY>
```

A successful HTTP response alone is not proof of completion. V0.1 emits
`artifact.status=built` only for explicit terminal success states. Non-terminal
responses remain rejected for the canonical proof requirement.

## Activation

```text
OSA_INTEGRATION_ENABLED=1
```

When this flag is absent, current fixture/provider behavior is unchanged.

Partial secret configuration is rejected. Selected capabilities whose bridge is
not configured fail closed and the canonical runtime produces a failed proof
receipt.

## OSA Agent command-center bridge

Existing `osa-agent` operator API is used as-is. The framework does not copy
its scheduler, Money Graph, RuntimeV2 or Cloud Run Job logic.

```text
OSA_AGENT_BASE_URL=https://<osa-agent-command-center>
OSA_AGENT_UI_TOKEN=<existing OSA_UI_TOKEN>
OSA_AGENT_TIMEOUT_MS=30000
```

`AUTONOMOUS_CYCLE` calls the existing `POST /api/control` surface. Default
action is `RUN_NOW`; an explicit `control_action` may select one of the
already-supported operator actions. A successful trigger is recorded as
`triggered`, not as completed work.

## Fleet bridge

The current Fleet repository is a model/chat control surface, not a second OSA
execution authority. V0.1 therefore wires only its existing SSE chat endpoint.

```text
OSA_FLEET_BASE_URL=https://<osa-agent-fleet-control-plane>
OSA_FLEET_API_KEY=<optional future/platform bearer token>
OSA_FLEET_MODEL=<optional>
OSA_FLEET_TEMPERATURE=<optional 0..2>
OSA_FLEET_TIMEOUT_MS=90000
```

`FLEET_CHAT` calls `POST /api/chat`, aggregates the existing SSE response and
returns the generated text as evidence/artifact. It does not create a duplicate
agent registry or execution authority.

## Canonical integration registry

Runtime startup now describes one registry:

```text
native-runtime        AGENT_TASK, VERIFY
builder               BUILD_CODE
execution-force       RUN_TOOL
osa-agent             AUTONOMOUS_CYCLE
fleet-control-plane   FLEET_CHAT
```

Each external component stays in its own repository and is reached through one
adapter boundary in `osa-proof`.

## Proof authority

`osa-proof` remains the only authority for the final V0.1 verdict.

External systems provide execution results and evidence inputs; they do not
self-assert the final OSA proof verdict.

## V0.1 non-goals

- no new memory layer
- no GOD LLM runtime
- no distributed scheduler
- no multi-model consensus
- no new 3D world
- no redesign
- no second proof engine
- no merge/deploy in this slice
