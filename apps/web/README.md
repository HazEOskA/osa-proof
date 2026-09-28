# OSA Web Integration

Routes:
- `/` — approved Choose Your Layer selector.
- `/school/` — V4 Most Wasted Academy/Public surface.
- `/dev/` — V3 HALO Builder/Core surface.
- `/bank/`, `/financial/`, `/cybersecurity/`, `/army/` — regulated gate surfaces.
- `/framework/` — Framework Console: static map of which framework features exist in code on `main`; missing features are underlined.

The selector calls `POST /layers/:id/enter` before navigation. Public layers receive `ALLOWED`; regulated layers receive `GATED`. Browser flags cannot unlock regulated capability.

`assets/osa-api-client.js` maps layer-entry plus Backend Slice #1 endpoints. It contains no runtime business logic.
