# OSA Proof — consolidacja mainline, 28.10.2026

## Cel

Jedno źródło prawdy, zamiast równoległych niezsynchronizowanych Preview. **Scalanie do `main` wymaga kontrolowanego CI i izolacji danych**, bo push do gałęzi produkcyjnej może uruchomić deployment. Nie uruchamiać automatycznie produkcji ani prywatnego NeurOSA.

## Zweryfikowane punkty Git

| Element | Dowód / stan |
|---|---|
| `main` przed konsolidacją | `721cf8cfe7c2fd216fa2a993e5871b0faa26bcdf` |
| sprawdzony kod chronionego Preview | `56dd60612f844faa9380c3243fe7eb9074a618d7` |
| docs status i Hermes Quick Start | `c133d0dd6b6b49275a36b8347a1dcfafe4b6340a` |
| nowszy kod Google/GitHub | `b073ee5def3f6498fbc6690cf7ad4f21a8d083ba` |
| scalenie Google/GitHub do konsolidacji | PR #29, `1704fcf1bb1db1d04306308445758f5ab81b7244` |
| PR z konsolidacji do main | **#30, Draft / nie scalony** |
| CI dla konsolidacji | `.github/workflows/mainline-consolidation.yml` |
| diffs po pierwszym połączeniu | 36 commitów przed main, 0 za main, 62 zmienione pliki (przed dodaniem samego CI i tego dokumentu) |

## Inwentaryzacja ważnych gałęzi

**Przodkowie `main`:** `codex/neurosa-chat-memory` (PR #17), `codex/product-e2e-audit-20261024` (PR #21), `fix/neurosa-delivery-gated-20261026` (PR #24), `fix/live-docs-neurosa-hermes-20261027` (PR #25), `fix/restore-osa-help-remove-public-hermes-tests-20261027` (PR #26), `fix/neurosa-prod-oauth-tenant-bind-20261027` (PR #27). Przodek Git **nie** gwarantuje, że późniejszy kod nie zmienił/nie usunął funkcji.

**Połączone na nowej gałęzi konsolidacji:** `integration/osa-proof-final-boss-e2e-20261028` poprzez potomną gałąź `fix/osa-proof-neurosa-protected-preview-20261028`, nowsze logowanie `feature/public-google-github-login-v1-20261027` przez PR #29; aktualizacje dokumentacji.

**Rozbieżne, nieprzejęte automatycznie — wymagają oceny funkcja po funkcji:**

| Gałąź / PR | Różnica względem main w chwili przeglądu | Decyzja |
|---|---|---|
| `fix/preview-login-entry-20261025` / PR #23 Draft | 22 ahead / 51 behind, konflikt Git | **NIE** łączyć starszego auth automatycznie; nowszy PR #28 jest już na gałęzi konsolidacji |
| `feat/p0a-telemetry-michael-fleet-20261025` / PR #22 Draft | 14 ahead / 51 behind | odrębna walidacja backendu i telemetry; brak połączenia |
| `feature/hermes-fleet-p1-controlled-proof-20261025` | 4 ahead / 75 behind | odrębny audyt runtime i uprawnień |
| `release/osa-proof-v0.1.0` / PR #16 closed, unmerged | 24 ahead / 77 behind | historyczna gałąź release; **nie** zastępuje nowego main |
| `codex/osa-preview-brain-test-20261023` / PR #18 Draft | 46 ahead / 77 behind | historyczny szeroki tor — 178 zmienionych plików, wymaga selekcji |
| `feature/agent-trust-fabric-v0.1` | 42 ahead / 77 behind | rozszerzenie architektury/bezpieczeństwa; nie wpychać w tym PR |
| `feature/osa-fleet-chat-slice1-proof` | 36 ahead / 79 behind | stary tor Fleet; obecny kod UI/runtime wymaga porównania funkcjonalnego |
| `feature/osa-unified-runtime-v1` | 143 ahead / 79 behind | historia rozbieżna; **nie** odtwarzać całości bez analizy |
| `feature/workspace-provider-v0.1` | 32 ahead / 125 behind | osobny tor workera |
| `feature/osa-worker-host-v0.1` | 52 ahead / 125 behind | osobny tor workera |
| `feature/worker-deploy-v0.1` | 63 ahead / 125 behind | osobny tor deploymentu |
| `feature/azure-worker-deploy-v0.1` | 76 ahead / 125 behind | oddzielny tor infrastruktury / koszty |
| `feature/native-builder-v0.1` | 14 ahead / 125 behind | osobny tor buildera |
| `feature/mastra-osa-integration-v1` | 38 ahead / 79 behind | analiza kontraktu zewnętrznego, nie wymagana do obecnego celu |
| `feature/osa-contextual-guide-v1` | 11 ahead / 78 behind | historyczny UI; powiązane poprawki `Zapytaj OSĘ` już na main |
| `proof/osa-proof-verification-20261025` | 1 ahead / 51 behind | narzędzie badawcze/anchor; niezależna ocena |
| `fix/docs-api-contract-20261024` | 7 ahead / 52 behind | porównać generated docs zamiast przenosić stare pliki |
| `fix/nvidia-free-endpoint-production-20261024` | 29 ahead / 77 behind | historyczna konfiguracja modeli; obecne API działa na Preview, brak produkcyjnego testu |
| `codex/osa-p1-fix03-preview-20261023` | 24 ahead / 77 behind | historia oboczna, weryfikować konkretne funkcje |
| `fix/recover-main-881f6bc` | 1 ahead / 158 behind | historyczna poprawka cofania regresji, nie łączyć w ciemno |

Gałęzie, które są w całości przodkami `main`, nie wymagają ponownego merge. Większość starszych pozostałych gałęzi jest redundantna lub archiwalna; nie usuwać ich bez osobnej polityki retencji. **Ahead/behind to genealogia commitów, nie licznik poprawnych funkcji.**

## Ryzyka i wymagane bramki

1. `vercel.json` na gałęzi ma `OSA_AUTH_MODE=open`; nowy publiczny OAuth wymaga `OSA_AUTH_MODE=session`, odpowiednich ustawień, rzeczywistych callbacków i per-user tenancy. **Scalenie kodu nie oznacza włączenia działającego logowania w produkcji.**
2. Chroniony operator NeurOSA na Preview jest przypięty do konkretnej gałęzi i hosta; nowa gałąź konsolidacji celowo **nie dziedziczy prywatnego dostępu**. Nie otwierać pamięci przez rozszerzenie allowlist bez testów.
3. W PR #28 live OAuth nie był testowany. Mock testy i Vercel build nie wystarczą do wdrożenia sesji.
4. Historia Replay (47 pozycji widzianych przez operatora) wymaga audytu rzeczywistego eksportu przez Hermesa; nie jest to 47 potwierdzonych uruchomień narzędzi.
5. Brak realnego sandboxu, niezależnej atestacji źródła i pełnej walidacji trwałości NeurOSA na Railway. `SECURITY_VERDICT.md` wskazuje `BLOCKED` do produkcji.
6. CI przy PR #30 musi sprawdzić **dokładne końcowe SHA**, a nie starszy wynik z innej gałęzi. Chronić produkcję przed automatycznym deployem błędnej wersji.

## Warunek zakończenia

`main` zawiera zatwierdzony, spójny zestaw funkcji; CI i testy regresji mają PASS na konkretnym SHA; kontrolowany Preview po scaleniu ma wykonany realny E2E (auth, pamięć, czat, eksport Proof/Trace/Replay); produkcja osobno włączona po przeglądzie uprawnień i rollback. Wszystko poniżej tego to `INTEGRATION_READY_FOR_TEST`, **nie** `PRODUCTION_READY`.
