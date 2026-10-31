# OSA Dashboard live control-plane integration

Stan dokumentacyjny: **31.10.2026**, kod z gałęzi `fix/proof-source-attribution-v1-20261031` (przed merge do `main`). Historyczna gałąź integracyjna: `feature/osa-dashboard-live-control-plane`.

Frontend artifact:
- path: `vendor/osa-dashboard-integrated-src.tgz`
- SHA-256: `672bfe6ab05dadf4cf140df36631836c433cdf42eedc8a80c25e08cfdb74c7cf`
- source: operator-supplied `osa-dashboard.zip`, integrated without a fake login gate

Vercel build:
1. `scripts/build-dashboard.cjs` copies the editable source `dashboard-src/` into `.osa-dashboard-src/`; only when `dashboard-src/package.json` is missing does it extract the vendored archive.
2. Skrypt wyszukuje rzeczywisty `npm/bin/npm-cli.js` przy Node.js (lub poprawną absolutną ścieżkę z `npm_execpath`) i uruchamia go przez `process.execPath` z `shell: false`; brak CLI kończy się `NPM_CLI_NOT_FOUND` zamiast fallbacku do `npm.cmd` / powłoki. Kopia wykonuje `npm install --no-audit --no-fund`.
3. `npm run build` uruchamia TypeScript `--noEmit` oraz Vite. Na Windows / Node.js 24.17.0 potwierdzono brak `EINVAL` i `DEP0190` z `--throw-deprecation`.
4. `dist/` is copied to `dashboard-dist/`, the Vercel output directory.
5. `apps/web/docs/` is copied to `dashboard-dist/docs/`, served at `/docs`.

API routing on Vercel: `vercel.json` rewrites every `/api/*` path (and the bare API routes) to the one function `api/osa.ts`, so multi-segment paths such as `/api/runs/:id` reach the API and all routes share one process state.

Backend bindings used by the dashboard:
- `GET /api/layers`
- `GET /api/teams/:id?version=:version`
- `GET /api/runs/:id`
- `POST /api/layers/:id/enter`
- `POST /api/teams`
- `POST /api/missions`
- `POST /api/missions/:id/run`
- Intelligence, datasets, evaluators, experiments, deployments, policies, queue, organizations, secrets and permissions screens use the matching `/api/...` routes listed in the docs HTTP API table (`/docs#api`).

Execution path:
`Team Graph -> Mission -> Runtime / Tool Gateway -> Events / ToolCallRecord -> Evidence / claim attribution -> ProofReceipt v2 -> Replay`

Current limitation:
`ApiState` obejmuje nadal stan procesowy. Dashboard ponownie rejestruje Team Graph / Mission przed wykonaniem; zimny start serwerless nie zapewnia trwałości chmurowej ani niezależnego dowodu wykonania.

Widoki **Proofs / Replay** pokazują status przypisania twierdzeń, hash odpowiedzi narzędzi i jawną granicę `egress_status: NOT_ENFORCED`, `signature_status: UNAVAILABLE`. Nie deklarują sandboxa, podpisu cyfrowego ani niezależnego źródła prawdy. Zmiany te są funkcjonalne; struktura i styl dashboardu pozostają bez zmian w aktualizacji dokumentacyjnej.

Walidacja operatora 31.10.2026: `npm test` **308 / 305 PASS / 0 FAIL / 3 SKIP** i `node --throw-deprecation scripts/build-dashboard.cjs` **FULL VALIDATION PASS** na Windows. [Bilans](./OSA_PROOF_STATUS_2026-10-31.md). Wyniki odnoszą się do commita kodu `fc4756f`, nie do produkcyjnego odbioru.

Snapshot mode remains a visibly labelled fallback. It is not presented as live evidence.
