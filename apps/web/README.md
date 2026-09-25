# OSA Web Integration

Static product shell for the locked OSA Proof architecture.

Routes:
- `/` — Choose Your Layer (visual preserved 1:1)
- `/school/` — supplied V4 Most Wasted Academy/Public surface
- `/dev/` — supplied V3 HALO Builder/Core surface
- `/bank/`, `/financial/`, `/cybersecurity/`, `/army/` — regulated access boundaries

`assets/osa-api-client.js` maps only the existing Backend Slice #1 endpoints: teams, missions, runs, events, evidence, proof. It contains no agent/runtime business logic.

The static shell expects the API to be available on the same origin (or `window.OSA_API_BASE_URL` to be set by the host).
