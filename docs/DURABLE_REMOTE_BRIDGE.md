# Production Durable Bridge

Vercel does not persist the queue or execute the worker in a serverless function. An authorized HTTPS gateway forwards only Durable routes to a dedicated adapter listening on `127.0.0.1:8791`. The bridge shares the existing FileDurableJobStore with an independent worker. It does not expose the dashboard, Ollama, workspace API or NeurOSA.

## Server-side configuration

Never put credentials into `VITE_*` environment variables or public documentation.

| Variable | Purpose |
| --- | --- |
| `OSA_DURABLE_REMOTE_URL` | HTTPS origin of the authenticated adapter |
| `OSA_DURABLE_REMOTE_TOKEN` | Random secret of at least 32 characters |
| `OSA_DURABLE_REMOTE_ORGANIZATION_ID`, `OSA_DURABLE_REMOTE_IDENTITY_ID`, `OSA_DURABLE_REMOTE_PROJECT_ID` | One exact verified owner/operator scope |
| `OSA_DURABLE_DIR` | Shared durable directory on the worker host |
| `OSA_DURABLE_BRIDGE_PORT` | Loopback port, default 8791 |

Build with `npm run build` and start the bridge with `npm run start:durable-bridge`. The persistent worker uses `npm run start:durable-worker` with its approved host configuration. Keep secrets outside the repository. Route the HTTPS tunnel exclusively to the bridge. Missing configuration, lost connectivity or stale heartbeat must not be reported as confirmed task acceptance.

For signed chat and Devnet Registry configuration, follow the [Registry protocol](./PROOF_REGISTRY_DEVNET.md); the signing key remains on the worker.

## Authorization boundary

Verified owner/operator session, exact scope, same-origin POST, bearer token and scope digest, bounded payloads, no redirects, timeout, idempotency and persisted evidence. The remember=true memory path is outside Durable. NeurOSA configuration is separate.

## Acceptance

The production-connected persistent host completed two signed Jeverson chat jobs; independent verification confirmed both Devnet commitments on 2026-11-27. See [execution evidence](./STATUS_2026-11-27.md).

To close formal browser recovery acceptance: log in, inspect `GET /api/durable/status` (HTTP 200, enabled=true and worker=HEALTHY), submit a task, close the tab after acknowledged acceptance, reopen the chat, recover the result and verify the corresponding receipt and anchor. The recorded cryptographic results and controlled CI recovery do not by themselves establish that production close/reopen sequence.
