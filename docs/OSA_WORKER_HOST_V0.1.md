# OSA Worker Host V0.1

Status: feature branch only. No merge to `main`, no production deploy.

## Goal

Move Native Builder execution off serverless infrastructure without moving or
redesigning the existing OSA dashboard.

The current visual system, Builder surface, typography and dashboard layout are
left untouched. This slice changes only the execution path behind BUILD_CODE.

## Canonical path

```text
OSA Dashboard / Control Plane
  -> Mission
  -> Capability Router
  -> BUILD_CODE
  -> Native Builder
  -> RemoteWorkspaceProvider
  -> HTTPS
  -> OSA Worker Host
  -> DockerWorkspaceProvider
  -> isolated workspace container
  -> Claude / Codex
  -> validation
  -> commit / push
  -> Evidence
  -> ProofReceipt
```

## Worker API

Public:

```text
GET /health
```

Authenticated:

```text
POST   /v1/workspaces
POST   /v1/workspaces/:id/exec
PUT    /v1/workspaces/:id/files
GET    /v1/workspaces/:id/ports/:port
DELETE /v1/workspaces/:id
```

All workspace operations require:

```text
Authorization: Bearer <OSA_WORKER_TOKEN>
```

The token comparison is fail-closed and constant-time.

## Worker configuration

```text
OSA_WORKER_TOKEN=<strong secret>
PORT=8787
HOST=0.0.0.0

OSA_WORKSPACE_DOCKER_IMAGE=osa/workspace-node22:v0.1
OSA_WORKSPACE_DOCKER_NETWORK=bridge
DOCKER_BIN=docker
```

Run on a trusted Docker host:

```bash
npm run workspace:image:build
npm run build
OSA_WORKER_TOKEN=... npm run worker:start
```

The worker removes orphaned containers carrying `osa.managed=true` at startup.

## Control Plane configuration

```text
OSA_BUILDER_MODE=native
OSA_WORKSPACE_PROVIDER=remote
OSA_WORKER_BASE_URL=https://<worker-host>
OSA_WORKER_TOKEN=<same strong secret>
OSA_WORKER_REQUEST_TIMEOUT_MS=120000
```

If `OSA_WORKSPACE_PROVIDER` is omitted while both worker URL and token are
present, Native Builder automatically prefers `remote`. Without remote worker
configuration it falls back to the local Docker provider.

## Workspace lifecycle

Create:

```text
RemoteWorkspaceProvider.create()
  -> POST /v1/workspaces
  -> DockerWorkspaceProvider.create()
```

Execute:

```text
WorkspaceHandle.exec()
  -> POST /v1/workspaces/:id/exec
  -> docker exec
```

Write:

```text
WorkspaceHandle.writeFile()
  -> PUT /v1/workspaces/:id/files
  -> base64 transport
  -> streamed into the workspace
```

Preview port:

```text
WorkspaceHandle.exposePort()
  -> GET /v1/workspaces/:id/ports/:port
  -> docker port
```

Cleanup:

```text
WorkspaceHandle.stop()
  -> DELETE /v1/workspaces/:id
  -> docker rm -f
```

The Worker Host also maintains an independent TTL for every workspace so a
disconnected control plane cannot leave an active workspace indefinitely.

## Resource and input limits

V0.1 validates workspace requests before Docker execution:

- timeout: 1 second to 24 hours
- CPU: greater than 0 and at most 32
- memory: 128 MiB to 128 GiB
- TCP ports: 1..65535
- JSON request body: at most 16 MiB

Files transported through the Worker API must remain under `/workspace`.

## Docker isolation boundary

Workspace containers have:

- no host filesystem mount
- no Docker socket mount
- explicit CPU and memory limits
- localhost-only preview port publication
- managed-container labels
- hard lifecycle cleanup

The Worker Host itself is the trusted execution boundary and therefore must run
on a host controlled by OSA.

## Verification

Contract suite validates:

- public health endpoint
- fail-closed workspace authentication
- remote create / exec / write / port / stop
- invalid token rejection
- workspace file boundary
- Docker provider contract

CI additionally builds the real OSA workspace image and verifies:

```text
RemoteWorkspaceProvider
  -> real Worker HTTP server
  -> real DockerWorkspaceProvider
  -> real container
  -> node execution
  -> file write/read
  -> cleanup
```

This proves the control-plane-to-worker protocol without Vercel Sandbox.

## Non-goals

V0.1 does not add:

- worker autoscaling
- distributed scheduling
- persistent workspace state
- Kubernetes
- Cloud Run worker execution
- Azure Container Apps worker execution
- public preview ingress
- dashboard redesign
- new fonts or visual language

Those remain separate slices.
