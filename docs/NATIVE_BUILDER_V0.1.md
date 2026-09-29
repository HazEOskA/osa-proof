# Native Builder V0.1

Status: implementation branch only. No merge to `main`, no production deploy.

## Goal

Make `osa-proof` the canonical BUILD_CODE platform instead of routing every
builder task through `coding-agent-platform` and `@vercel/sandbox`.

The old Coding Agent Platform remains available only as an explicit legacy
adapter during migration.

## Canonical path

```text
Mission
  -> Capability Router
  -> BUILD_CODE
  -> OSA Native Builder
  -> WorkspaceProvider
  -> repo clone / branch
  -> Claude or Codex CLI
  -> validation gates
  -> commit / push
  -> Evidence
  -> OSA Proof
```

## New packages

```text
packages/workspace-runtime/
  src/index.ts

packages/builder-core/
  src/types.ts
  src/commands.ts
  src/validation.ts
  src/git.ts
  src/agents.ts
  src/builder.ts
  src/executor.ts
  src/index.ts
```

### workspace-runtime

Defines the provider-neutral execution contract:

- `WorkspaceProvider.create()`
- `WorkspaceHandle.exec()`
- `WorkspaceHandle.writeFile()`
- optional `WorkspaceHandle.exposePort()`
- `WorkspaceHandle.stop()`

No Vercel type or SDK is part of this contract.

No concrete workspace provider is shipped in V0.1. Until one is registered,
BUILD_CODE fails closed with `WORKSPACE_PROVIDER_NOT_CONFIGURED`.

That boundary is intentional: workspace infrastructure is the next isolated
slice and does not leak into Builder Core.

### builder-core

Ported from the useful parts of Coding Agent Platform:

- repository preparation
- credential-free git remote policy
- branch creation / branch resume
- dependency bootstrap
- validation-before-push
- type-check / lint / build / test gates
- commit / push lifecycle
- Claude CLI execution
- Codex CLI execution
- normalized task result
- proof-bound evidence

The native core no longer depends on:

- `@vercel/sandbox`
- `@vercel/sdk`
- Vercel OIDC
- Vercel project/team APIs
- Vercel deployment protection
- Builder HTTP polling

## Agent credentials

Native agent execution uses provider credentials directly:

```text
ANTHROPIC_API_KEY
OPENAI_API_KEY
OSA_BUILDER_GITHUB_TOKEN
```

Optional builder-specific aliases are accepted for model credentials:

```text
OSA_BUILDER_ANTHROPIC_API_KEY
OSA_BUILDER_OPENAI_API_KEY
```

Repository credentials are injected only into platform-owned git network
commands. They are not written into the git origin URL or passed to the coding
agent process.

## Builder mode

Default:

```text
OSA_BUILDER_MODE=native
```

This is also the implicit default if the variable is absent.

Legacy migration mode must be explicitly requested:

```text
OSA_BUILDER_MODE=legacy
OSA_INTEGRATION_ENABLED=1
OSA_BUILDER_BASE_URL=...
OSA_BUILDER_BRIDGE_TOKEN=...
```

The old HTTP bridge is retained only so migration does not require a flag day.

## Current execution boundary

Native Builder V0.1 owns the Builder logic, but it intentionally does not yet
select a cloud runtime.

A concrete provider must register itself in `workspaceProviders`, for example:

```text
docker
cloud-run
azure-container-apps
kubernetes
local-worker
```

Then:

```text
OSA_WORKSPACE_PROVIDER=<registered-provider-id>
```

The next workspace slice can therefore change infrastructure without changing
Builder Core, routing, evidence, or Proof.

## Proof semantics

The native builder never reports `artifact.status=built` merely because an
agent returned successfully.

`built` requires:

1. agent execution succeeded,
2. repository changes exist,
3. validation permits push,
4. commit succeeds,
5. push succeeds.

No changes produce `no_changes`; failures produce `rejected`.

## Donor repository status

`HazEOskA/coding-agent-platform` remains untouched by this slice and acts as a
legacy UI / migration donor. It is no longer the canonical design authority for
BUILD_CODE.
