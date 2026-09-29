# Integration Slice V0.1

Status: implementation branch only. No merge to `main`, no production deploy.

## Goal

Wire existing OSA components behind the canonical `osa-proof` runtime without rewriting them:

```text
Dashboard
  -> Team Graph / Mission
  -> OSA Runtime
  -> deterministic capability router
       BUILD_CODE -> Coding Agent Platform
       RUN_TOOL   -> OSA Execution Force Runtime V2
       AGENT_TASK -> existing native DEV executor
       VERIFY     -> existing native DEV executor -> canonical OSA Proof verifier
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
