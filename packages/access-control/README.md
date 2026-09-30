# @osa/access-control

Authoritative product-layer entry boundary.

Current contract:
- `SCHOOL` → public Academy entry.
- `DEV` → public Builder/Core entry.
- `BANK`, `FINANCIAL`, `CYBERSECURITY`, `ARMY` → regulated and backend-gated.

Regulated entry is **fail closed**. The browser cannot unlock a regulated layer by sending self-asserted flags. Until a real organization / affiliation / entitlement service exists, the backend returns `GATED` and only exposes the gate surface.

This package does not implement identity verification or regulated capabilities.
