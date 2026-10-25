# OSA Proof — Preview Login / GitHub OAuth (2026-10-25)

## Root cause (verified)
Vercel project `osa-proof` has `ssoProtection.enabled=true`, `deploymentType=preview`. The Vercel gate runs **before** the app; a Login button inside React cannot bypass it.
On main, `vercel.json` forces `OSA_AUTH_MODE=open`, and `apps/api/src/index.ts` explicitly disabled `/auth/*` in that mode. There was no header Login button.

## Scope / behavior
This branch adds a prominent **Zaloguj** button top-right in dashboard and Jeverson chat, GitHub provider status and sign-out.
The Vercel API preview branch **requires a signed application session** for API writes and private run reads; no local-dev login in Vercel.
Exception: previously approved **NeurOSA single-operator** route stays host+branch isolated, and MUST remain protected by Vercel Authentication until separately migrated and tested.
Production auth behavior is unchanged until an explicitly approved merge/release.

The OAuth implementation is a brokered authorization-code flow for dynamic Preview URLs:
1. Origin Preview `GET /api/auth/github/start` creates nonce, PKCE S256 verifier (Secure HttpOnly 10-minute cookie), signed HMAC state containing the validated originating origin.
2. GitHub redirects only to the **stable** `OSA_GITHUB_CALLBACK_ORIGIN/api/auth/github/callback`. The broker validates signed state, the origin allowlist, timestamp and code format, and hands off code+state via cross-origin POST (not querystring) to the original Preview URL.
3. Origin Preview checks signed state + matching HttpOnly nonce and exchanges the GitHub authorization code server-side; it fetches the GitHub user and matches the server-side numeric **allowlist**.
4. Successful login creates an 8-hour HMAC-signed `__Host-osa_session` Secure/HttpOnly/Lax cookie. The browser never sees access tokens or client secret. Logout clears session cookie.

A malicious/unknown GitHub ID does not receive a session. Authentication does not implicitly make all capabilities permissible; API tenant/policy checks remain applicable. A broken/absent OAuth setup is **503/GITHUB_OAUTH_NOT_CONFIGURED**, not an unauthenticated bypass.

## Server configuration (set via Vercel environment UI, NEVER chat/repo)
Required on Preview and on the future **stable callback broker**:
- `OSA_GITHUB_CLIENT_ID` and `OSA_GITHUB_CLIENT_SECRET`: GitHub OAuth App credentials;
- `OSA_GITHUB_SESSION_SECRET`: securely generated random secret, minimum 32 characters, SAME across Preview and stable callback origin, never committed;
- `OSA_GITHUB_ALLOWED_USER_IDS`: comma-separated numeric GitHub user IDs for authorized operators;
- `OSA_GITHUB_CALLBACK_ORIGIN`: canonical fixed host, e.g. `https://osa-proof-three.vercel.app` (must deploy this callback implementation there before live activation);
- Optional tenant scope `OSA_GITHUB_ORGANIZATION_ID` and `OSA_GITHUB_PROJECT_ID` pinned server-side;
- Optional `OSA_GITHUB_ALLOWED_ORIGINS`: exact additional trusted custom HTTPS origins. Built-in preview allowlist is project-prefixed `osa-proof*.vercel.app`.

GitHub OAuth App **Authorization callback URL** should be
`https://osa-proof-three.vercel.app/api/auth/github/callback` (or the explicitly configured stable callback host).

## Vercel deployment protection — IMPORTANT
Do **not** globally disable Vercel Authentication while the existing NeurOSA private Preview relies on that entry gate.
A new app Login UI is unreachable until Vercel allows the request through. To let public Preview testing work without Vercel account permissions, use a separately authorized environment/project/domain with fully configured GitHub OAuth and explicit tenant policies **after** validating the broker and NeurOSA isolation.
A Preview share link or protection bypass grants access to its target; do not use it for private NeurOSA.
No production promotion, merge, Vercel protection changes, secret creation or Railway action was authorized/performed by this branch.

## Acceptance
- UI desktop and mobile: Login top right in normal shell and Jeverson immersive chat.
- `tests/github-preview-login.test.ts`: signed-state broker, PKCE challenge, same-origin session, user ID allowlist, host and replay rejection.
- `npm ci && npm test && node scripts/build-dashboard.cjs`.
- Real login requires callback deployment and protected env setup; CI alone cannot prove actual GitHub/Vercel end-to-end.
- **CLAIM != PROOF**: mark LIVE OAuth as BLOCKED until user can load a new Preview URL, sign in, refresh, see verified `/api/session`, run a mission and logout with rejection afterwards.
