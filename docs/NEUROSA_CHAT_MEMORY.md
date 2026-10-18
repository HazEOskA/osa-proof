# NeurOSA ↔ OSA Proof — bez GitHub OAuth na chronionym Preview

## PR #17 (18.10.2026)

Nie ma przycisków logowania ani tras GitHub OAuth. Preview korzysta ze wspólnej tożsamości serwerowej `vercel-preview`, wyłącznie na branch-aliasie:
`osa-proof-git-codex-neurosa-chat-memory-osabarca-1680s-projects.vercel.app`.

Warunki: `VERCEL=1`, `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=codex/neurosa-chat-memory`, `OSA_PREVIEW_SINGLE_OPERATOR=enabled` ograniczone do tej gałęzi i pięć sekretów `OSA_NEUROSA_*`. Gdy dostępna jest metadana właściciela lub repo, musi zgadzać się z `HazEOskA/osa-proof`. Jeśli Preview nie spełnia warunków, pamięć nie zostanie zamontowana (fail-closed).

Zachowana jest Vercel Deployment Protection. **Ostrzeżenie:** Vercel Shareable Link lub bypass mogą umożliwiać dostęp do chronionego Preview bez logowania do Vercel; każdy, kto ma taki dostęp, działa w tym modelu jako operator prywatnego brain. Nie udostępniaj linków i rozważ ich cofnięcie, zanim przetworzysz prywatne dane. Ta zmiana nie tworzy ani nie cofa wyjątków ochrony.

**Izolacja hosta:** osobne `ApiState` dla chronionego aliasu i wszystkich pozostałych aliasów tego samego deploymentu. `agentworlds.dev` i każdy inny host nadal nie dostają adaptera prywatnej NeurOSA, nawet jeśli wskazują na ten sam deployment. Prywatny token znajduje się tylko na serwerze i nigdy nie trafia do frontend.

Po przejściu kontroli tożsamości i scope `GET /memory/status` wykonuje prawdziwy probe `/api/v1/brain/status` do NeurOSA. `AVAILABLE` wymaga zgodnego brainId i `ledgerValid`. Czat korzysta z istniejących endpointów `/nvidia/fleet-chat`, remember i recall; zdarzenia są hashowane i sprawdzane na odczycie. Bez płatnego testu modelu, automatycznego restartu i deklarowania ukończonego pełnego E2E.

## Status dowodowy

CI i READY Preview to tylko dowód kompilacji. Rzeczywisty `/memory/status`, zapis i recall na kanonicznej VM nie są oznaczane jako VERIFIED przed wywołaniem przez operatora. Trwałość po restarcie osobno niezweryfikowana.

Bez merge do main i bez zmian Production.
