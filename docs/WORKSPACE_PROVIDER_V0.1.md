# Workspace Provider V0.1

Status: feature branch only. No merge to `main`, no production deploy.

## Goal

Provide the first OSA-owned workspace runtime for Native Builder without Vercel.

Canonical path:

```text
BUILD_CODE
  -> OSA Native Builder
  -> DockerWorkspaceProvider
  -> isolated OSA container
  -> /workspace/project
  -> Claude / Codex
  -> validation
  -> commit / push
  -> Evidence
  -> Proof
```

## Provider

Provider id:

```text
docker
```

It is registered automatically by the API runtime and is the default when
`OSA_WORKSPACE_PROVIDER` is absent.

The provider uses only the Docker CLI. Builder Core remains cloud-neutral.

### Contract

```text
WorkspaceProvider.create()
WorkspaceHandle.exec()
WorkspaceHandle.writeFile()
WorkspaceHandle.exposePort()
WorkspaceHandle.stop()
```

## Isolation

Each workspace receives:

- a unique managed container,
- bounded CPU and memory,
- a hard lifetime timeout,
- its own `/workspace/project`,
- no host filesystem mount,
- no Docker socket mount,
- bridge networking for repository/model access,
- optional localhost-only published preview ports,
- forced removal during Builder cleanup.

The provider labels managed containers with:

```text
osa.managed=true
osa.workspace.id=<mission/task id>
```

## Workspace image

Canonical image:

```text
osa/workspace-node22:v0.1
```

Build locally:

```bash
npm run workspace:image:build
```

Image contents are intentionally small:

- Node.js 22
- git
- curl
- bash
- Python 3
- pip
- jq
- OpenSSH client
- CA certificates

Claude and Codex installation remains owned by Builder agent adapters rather
than the workspace image.

## Configuration

```text
OSA_BUILDER_MODE=native
OSA_WORKSPACE_PROVIDER=docker
OSA_WORKSPACE_DOCKER_IMAGE=osa/workspace-node22:v0.1
OSA_WORKSPACE_DOCKER_NETWORK=bridge
DOCKER_BIN=docker
```

Only `OSA_BUILDER_MODE=native` is conceptually required. The remaining values
have the defaults shown above.

## Credential boundary

Repository/model credentials are not baked into the image or container
creation config.

Git credentials are injected only into platform-owned network git commands.
Model keys are passed only to the relevant agent process with `docker exec -e`.

## Preview ports

V0.1 publishes the common development ports 3000 and 5173 to ephemeral
localhost host ports. `WorkspaceHandle.exposePort(port)` resolves the mapping.

This is a local-provider preview surface only; it is not yet a public routing or
ingress platform.

## Verification

Contract tests use an injected fake Docker CLI to verify command construction,
credential placement, file streaming, port lookup, naming and idempotent
cleanup.

The CI workflow additionally:

1. builds `osa/workspace-node22:v0.1`,
2. creates a real Docker workspace,
3. executes Node inside it,
4. writes and reads a workspace file,
5. removes the container.

## Non-goals

V0.1 does not add:

- Kubernetes
- Cloud Run workspace execution
- Azure Container Apps workspace execution
- multi-host scheduling
- autoscaling
- public ingress
- image registry control plane
- persistent workspaces

Those can be added later as additional `WorkspaceProvider` implementations
without changing Native Builder.
