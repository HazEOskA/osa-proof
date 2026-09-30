# OSA Dashboard live control-plane integration

Branch: `feature/osa-dashboard-live-control-plane`

Frontend artifact:
- path: `vendor/osa-dashboard-integrated-src.tgz`
- SHA-256: `672bfe6ab05dadf4cf140df36631836c433cdf42eedc8a80c25e08cfdb74c7cf`
- source: operator-supplied `osa-dashboard.zip`, integrated without a fake login gate

Vercel build:
1. `scripts/build-dashboard.cjs` extracts the vendored dashboard into `.osa-dashboard-src/`.
2. The extracted package runs `npm install --no-audit --no-fund`.
3. `npm run build` runs TypeScript no-emit verification and Vite.
4. `dist/` is copied to `dashboard-dist/`, the Vercel output directory.

Backend bindings used by the dashboard:
- `GET /api/layers`
- `GET /api/teams/:id?version=:version`
- `GET /api/runs/:id`
- `POST /api/layers/:id/enter`
- `POST /api/teams`
- `POST /api/missions`
- `POST /api/missions/:id/run`

Execution path:
`Team Graph -> Mission -> Runtime -> Events -> Evidence -> ProofReceipt v2`

Current limitation:
`ApiState` is process-memory state. The dashboard re-seeds the Team Graph and Mission immediately before each live run so serverless cold starts do not silently reuse stale state.

Snapshot mode remains a visibly labelled fallback. It is not presented as live evidence.
