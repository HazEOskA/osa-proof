# OSA Web Integration

Static product shell for the locked OSA Proof architecture.

Routes:
- `/` — Choose Your Layer selector, visually preserved from the approved reference.
- `/school/` — supplied V4 Most Wasted Academy/Public surface.
- `/dev/` — supplied V3 HALO Builder/Core surface.
- `/bank/`, `/financial/`, `/cybersecurity/`, `/army/` — regulated access boundaries.

The selector must call `POST /layers/:id/enter` before navigation. Public layers receive `ALLOWED`; regulated layers receive `GATED` and navigate only to the gate surface. No browser flag can unlock regulated capability.

`assets/osa-api-client.js` maps layer-entry plus Backend Slice #1 endpoints. It contains no agent/runtime business logic.

The static shell expects the API on the same origin, or `window.OSA_API_BASE_URL` to be set by the host.
