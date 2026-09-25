# OSA Proof API

Backend HTTP boundary for product-layer access plus Team Graph execution, missions, runs, events, evidence, and proof receipts.

Layer entry:
- `GET /layers`
- `GET /layers/:id`
- `POST /layers/:id/enter`

Runtime:
- `POST /teams`
- `GET /teams/:id?version=:version`
- `POST /missions`
- `POST /missions/:id/run`
- `GET /runs/:id`
- `GET /runs/:id/events`
- `GET /runs/:id/evidence`
- `GET /runs/:id/proof`

The UI is a client. Regulated entry decisions are backend-authoritative.
