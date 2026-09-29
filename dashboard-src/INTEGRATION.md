# OSA Dashboard integration

This frontend is the control surface for `HazEOskA/osa-proof`.

Live read paths:
- `GET /api/layers`
- `GET /api/teams/:id?version=:version`
- `GET /api/runs/:id`

Live write paths wired by this dashboard:
- `POST /api/layers/:id/enter`
- `POST /api/teams`
- `POST /api/missions`
- `POST /api/missions/:id/run`

The current backend stores `ApiState` in process memory. The dashboard therefore re-seeds the Team Graph and selected mission immediately before each run. This makes the write path robust to a Vercel cold start, but it is not durable persistence.

Proofs are rendered from backend `osa.proof_receipt.v2` and independently recomputed in-browser by the existing Proofs view. Snapshot data remains a clearly labelled fallback when the live API is unavailable.

Authentication is intentionally not simulated. The dashboard opens directly because `osa-proof` does not currently expose an authentication endpoint.

Build dependencies are pinned exactly in this frontend package; deployment uses `npm install --no-audit --no-fund` before the Vite build.
