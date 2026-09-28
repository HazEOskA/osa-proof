# @osa/access-control

Authoritative product-layer entry boundary.

- `SCHOOL` → public Academy entry.
- `DEV` → public Builder/Core entry.
- `BANK`, `FINANCIAL`, `CYBERSECURITY`, `ARMY` → regulated and backend-gated.

Regulated entry is **fail closed**. Browser-supplied self-asserted flags cannot unlock it. Until a real organization / affiliation / entitlement service exists, the backend returns `GATED` and only exposes the gate surface.

No identity verification or regulated capability is implemented here.
