# OSA Web Integration

Static product shell for the locked OSA Proof architecture.

Routes:
- `/` — approved Choose Your Layer selector.
- `/school/` — V4 Most Wasted Academy/Public surface.
- `/dev/` — V3 HALO Builder/Core surface.
- `/bank/`, `/financial/`, `/cybersecurity/`, `/army/` — regulated gate surfaces.
- `/framework/` — Framework Console: static map of which framework features exist in code on `main`; missing features are underlined.
- `/console/` — Tracing console (LangSmith / LangGraph Studio feature set) on the OSA Framework design system; static snapshot of 3 sealed runs, receipts re-verified in the browser. Missing backend features are underlined.
- `/docs/` — Documentation home: quickstart, first mission, concepts, proof receipt, layers, configuration and HTTP API. Missing backend features are underlined.

The selector must call `POST /layers/:id/enter` before navigation. Public layers receive `ALLOWED`; regulated layers receive `GATED` and navigate only to the gate surface. No browser flag can unlock regulated capability.

`assets/osa-api-client.js` maps layer-entry plus Backend Slice #1 endpoints. It contains no agent/runtime business logic.

The static shell expects the API on the same origin, or `window.OSA_API_BASE_URL` to be set by the host.
