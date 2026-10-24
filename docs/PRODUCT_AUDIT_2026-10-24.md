# OSA Proof — audyt gotowości produktu, 24.10.2026

## Werdykt

**BLOCKED do wydania pełnego produktu; działający kandydat demonstracyjny z lokalnie sprawdzonym rdzeniem.**

Repozytorium: `HazEOskA/osa-proof`. Baza audytu: `main@76e06f33190d573353e76f5816aea0af0ce3e302`. Gałąź poprawek: `codex/product-e2e-audit-20261024`. Produkcyjny alias `https://osa-proof-three.vercel.app/` wskazywał podczas audytu ten sam commit (Vercel `dpl_vX8Mpz3mMWMsvBBxTyyV3mYMM1ts`). Otwarty PR #18 ma bazę `release/osa-proof-v0.1.0`, head `0446fb149e7f3f7c07c88fc3bdc9977cb5a1a315`; GitHub zwrócił `mergeable:false`. Nie przeniesiono jego 32 plików ani nie naruszono wcześniejszego lokalnego checkoutu z niezacommitowanymi poprawkami.

Zakres: katalog narzędzi i wykonawców, 85 tras HTTP, testy wszystkich plików TypeScript objętych `npm test`, kontrakt adaptera Mastra, build panelu, przegląd źródeł integracji i nawigacji produkcyjnej, katalog NVIDIA. Bez zmiany wyglądu, merge, produkcyjnego deployu, konfiguracji usług, instalacji skilli i płatnych wywołań.

**Nie ma podstaw do rzetelnego procentu gotowości ani daty zakończenia.** Dla pełnego zakresu panelu zdefiniowano poniżej osiem bramek odbioru. Zielone testy fixture i HTTP 200 nie zamykają tych bramek.

## Dowody wykonane w tej sesji

| Sprawdzenie | Wynik | Granica dowodu |
| --- | --- | --- |
| Bazowe `npm test` | 250 PASS / 0 FAIL / 3 SKIP | Przed poprawkami; większość integracji używa kontrolowanego transportu |
| Końcowe `npm test` | 253 PASS / 0 FAIL / 3 SKIP | 256 testów; dodano regresje granic danych i odpowiedzi NVIDIA |
| `node --test tests/mastra-osa-adapter.test.mjs` | 12 PASS / 0 FAIL | Adapter; nie realny SDK Mastra ani zewnętrzny model |
| `node scripts/audit-product-e2e.cjs` | 85/85 kontraktów HTTP PASS | 54 trasy wymagają 401 bez sesji; 31 publicznych odpowiada kontrolowanie; nie 85 scenariuszy biznesowych |
| Natywne narzędzia przez lokalny HTTP | 3 PASS | SHA-256, inspekcja rzeczywistego lokalnego API, health istniejącego hosta workera |
| Weryfikacja wyniku i naruszenia | 3 PASS | Każdy z trzech bundle przechodzi verifier; podmieniony final_output zostaje odrzucony |
| Negatywne bramki narzędzi | 2 PASS | Nieobsługiwane zadanie BLOCKED; podszycie pod dispatch modelu bez tokenu 403 |
| `node scripts/build-dashboard.cjs` | PASS | TypeScript + Vite; JS około 1,41 MB, gzip około 609 KB |
| Produkcyjne odczyty statusów | 5 × HTTP 200 | Tryb fixture/open, pamięć UNCONFIGURED, stan PROCESS_MEMORY, brak cloud providers |
| Przegląd panelu produkcyjnego | Nawigacja do ponad 50 pozycji menu | Obserwacja widoków, nie dowód działania każdego przycisku lub zapisu |
| Browser E2E lokalnych zmian | BLOCKED środowiskowo | Brak Chromium; oficjalne pobranie Playwright zwróciło uszkodzone archiwum; nie oznaczono PASS |
| Składnia skryptów i `git diff --check` | PASS | Nie zastępuje uruchomienia browser E2E |
| Live model → tool_calls → Runtime → Proof | NOT TESTED | Brak użycia kluczy providerów i brak potwierdzonego bezpłatnego wywołania |
| Realny Docker / zewnętrzny Fleet | NOT TESTED | Brak Dockera i wskazanego zewnętrznego serwisu w tym runtime |

Trzy standardowe pominięcia: `OSA_LIVE_PROVIDER_TEST`, `OSA_LOCAL_DOCKER_TEST`, `OSA_E2E_FLEET_URL/TOKEN`. Historyczne zielone Actions dla innych SHA nie zostały zaliczone jako walidacja aktualnego kodu.

Dowody: [lokalny HTTP i inventory](./evidence/product-audit-2026-10-24/local-http.json), [produkcja — tylko odczyty](./evidence/product-audit-2026-10-24/production-readonly.json), [podsumowanie komend](./evidence/product-audit-2026-10-24/verification.json). Przechwycone identyfikatory lokalnych wykonań służą odtworzeniu i kontroli audytu; nie są dowodem działania produkcyjnego providera.

## Naprawione błędy i ochrona przed regresją

1. **NVIDIA przyjmowała nieukończoną odpowiedź jako sukces.** Odtworzono `finish_reason=length/content_filter/tool_calls` z wynikiem `PROVIDER_RESPONSE`. Most tekstowy odrzuca teraz jawne niepowodzenie zakończenia, refusal oraz nieobsłużone tool_calls. Brak finish_reason pozostaje kompatybilny ze starszymi odpowiedziami. To nie dodaje wykonywania narzędzi modelowych.
2. **Odpowiedź NVIDIA była wczytywana bez limitu przed parsowaniem JSON.** Dodano limit 256 KiB i anulowanie strumienia; osobny test sprawdza anulowanie. Istniejący limit 40 tys. znaków odpowiedzi pozostaje.
3. **Wspólny parser żądań API buforował dowolnie duże body.** Dodano limit 4 MiB liczony w bajtach, HTTP 413 oraz stabilny, nieujawniający treści błąd INVALID_JSON. Trasy mające własne niższe limity zachowują je. Test sprawdza odrzucenie, brak utworzenia nadmiarowego zasobu i poprawną kolejną operację.
4. **Test Laboratorium wdrożeń używał angielskich selektorów po polonizacji UI.** Poprawiono nazwy przycisków, pól, iframe i komunikatu rezultatu. Test dodano do workflow PR. Wykonanie w przeglądarce wymaga jeszcze wyniku CI.
5. **Starszy browser test TRACE oczekiwał nieistniejącego iframe, dialogu i angielskich kart.** Skrypt korzysta teraz z istniejącego czatu natywnego, przycisku ŚLEDZENIE OSA, inspektora i weryfikacji bundle w przeglądarce, włącznie z symulacją naruszenia. Workflow uruchamia się również dla PR do main. Wykonanie browser E2E nadal niezweryfikowane lokalnie.
6. **Brak jednego powtarzalnego raportu kontraktów wszystkich tras i natywnych narzędzi.** Dodano bezpłatny lokalny skrypt audytu i artefakt CI. Nie utożsamia on kompletnego inventory z pełnym pokryciem funkcjonalnym.

## Inventory narzędzi — 18 zarejestrowanych executor refs

| Wykonawcy | Obecny dowód | Brak do pełnego produktu |
| --- | --- | --- |
| `dev.planner.v1`, `dev.builder.v1`, `dev.planner.fixture.v1`, `dev.builder.fixture.v1` | Testy natywnego Runtime i handoff; produkcja fixture | Dowód wykonania z prawdziwym providerem, kontrola kosztu i trwałości |
| `osa.crypto.sha256.v1` | Lokalny HTTP → rzeczywisty SHA → ProofReceipt → verifier PASS | Ten sam scenariusz wybrany przez prawdziwy model |
| `osa.runtime.inspect.v1` | Dwa rzeczywiste lokalne GET → evidence → Proof PASS | Test chronionego wdrożenia z poprawnym originem |
| `osa.worker.health.v1` | Rzeczywisty lokalny Worker Host health PASS | Health nie potwierdza uruchomienia kontenera lub wykonania zadania |
| `osa.conversation.record.v1` | Testy kontraktu provenance i odmowa nieautoryzowanego dispatch | Prawdziwa odpowiedź modelu z tożsamością wykonania; brak dowodu z tego audytu |
| `osa.unified.blocked.v1` | BLOCKED dla nieobsługiwanego polecenia PASS | Celowa bramka, nie brakująca funkcja do automatycznego odblokowania |
| `osa.native-builder.v1` | Rejestracja i kontrola bramki; bez wykonania w domyślnym środowisku | Realny zatwierdzony sandbox/build/test i cleanup |
| `web3.read.v1`, `web3.monitor.v1`, `web3.analyze.v1`, `web3.risk.v1`, `web3.verify.v1` | Testy polityk, RPC/normalizacji i proof z kontrolowanymi transportami | Oddzielny test rzeczywistego RPC, błędów i uprawnień |
| `web3.prepareTransaction.v1`, `web3.simulate.v1`, `web3.execute.v1` | Celowe blokady operacji write | Decyzja produktowa o zakresie; brak uprawnień do podpisywania i transakcji |

**Narzędzia / Umiejętności / MCP-A2A w UI są katalogiem konfiguracji, a nie listą połączonych wykonawców.** W przeglądanej sesji katalogi były puste. `McpHttpIntegration` jest biblioteką klienta JSON Streamable HTTP; test przechodzi na kontrolowanym serwerze, a edytor połączeń nie wykonuje automatycznej rejestracji rzeczywistego serwera MCP. SSE i stdio nie są obsługiwane przez ten adapter. A2A w edytorze jest konfiguracją — brak dowodu aktywnego transportu.

`PlatformControlPlane` pokazuje capabilities, lecz cloud registry jest pusty i `deployment_execution_enabled=false`. Rejestracja wykonawcy nie oznacza jego operacyjnej dostępności: native builder ma odrębną bramkę, a Web3 write pozostaje zablokowane.

## Macierz modułów

| Obszar | Stan potwierdzony | Luka |
| --- | --- | --- |
| Team Graph, Mission Kernel, Runtime, Events, Proof, Replay | Lokalny core PASS, również negatywne i restartowe testy FileMissionStore | Serverless ApiState i indeksy produkcyjne nadal PROCESS_MEMORY |
| Modele / LLM Gateway / Model Mesh | Testy transportów, retry, routing i metadanych PASS | Status modułu LIVE wynika z wbudowanych proof checks, nie z wywołania produkcyjnego modelu |
| Czat floty i role agentów | UI i profile istnieją; modelowy most rozmowy | Model nie wysyła w tej ścieżce listy tools; ręczny router narzędzi nie dowodzi modelowego tool_calls |
| Pamięć NeurOSA | Kontrakty, izolacja i kontrolowane testy recall PASS | Produkcyjny status UNCONFIGURED; prywatna integracja celowo ograniczona do konkretnego chronionego Preview |
| Knowledge / Datasets / Evaluators / Experiments | Testy HTTP, hashe, scoring, porównania PASS | Stan procesu, brak pełnej produkcyjnej izolacji i trwałego magazynu |
| Tools / Skills / MCP / A2A / Prompts / Studio | Edytory, rewizje i walidacja konfiguracji | Konfiguracja nie dowodzi wykonania; zewnętrzne mosty wymagają podłączenia i acceptance testów |
| Laboratorium wdrożeń | Rzeczywiste artefakty starter i pipeline dziesięciu ról testowane lokalnie | Produkcja: connected model BLOCKED, worker BLOCKED, Azure BLOCKED |
| Worker / Fleet / Sandbox | Lokalne kontrakty i zabezpieczenia PASS | Brak realnego Dockera i zewnętrznej floty w bieżącym audycie |
| Queue / Scheduler / Deployments | Testy kontraktów i polityk PASS | Drain wyzwalany żądaniem, brak trwałej kolejki i potwierdzonego workera produkcyjnego |
| Web3 | Odczyt/polityki/proof mają testy | Live RPC niezweryfikowane; write celowo niedostępne |
| World / Graph / Timeline / Monitoring | Widoki i nawigacja istnieją | Część prezentuje snapshot; wejście na ekran nie oznacza działania live telemetrii |
| Identity / Organizations / Permissions | Egzekwowanie kontraktu 54 tras w session mode PASS | Publiczna produkcja open, lokalna tożsamość DEV i współdzielone katalogi nie stanowią enterprise RBAC |
| Piaskownice, Context Hub, Chmura, Infrastruktura | UI sygnalizuje SOON/WKRÓTCE | Funkcje nie są gotowe; nie odblokowywano ich kosmetycznie |

## Osiem bramek do pełnego produktu i kolejność prac

| Priorytet / bramka | Wymagana praca | Dowód zamknięcia |
| --- | --- | --- |
| P0 / G1: modelowy E2E | Uzgodnić poprawki PR #18 z aktualnym main; wybrać faktycznie dostępny bezpłatny model bez cichego fallbacku; spiąć dispatch z istniejącym Runtime | Prawdziwe `tool_calls` → trzy dozwolone narzędzia → trace/evidence/ProofReceipt, stałe ID w obrębie operacji, różne ID nowych operacji |
| P0 / G2: trwały stan i pamięć | Dokończyć istniejący trwały storage, rezerwacje/idempotencję i indeksy; podłączyć NeurOSA w docelowym prywatnym środowisku | Restart/redeploy i równoległe retry nie dublują narzędzia; odczyt receipt oraz recall działają po restarcie |
| P0 / G3: tożsamość i tenant isolation | Rozdzielić publiczne demo od prywatnego workspace; rzeczywista tożsamość i członkostwo; objąć katalogi, kolejki i odczyty danych | Test dwóch organizacji, brak wzajemnych odczytów i mutacji; open demo nie daje dostępu do danych prywatnych |
| P0 / G4: worker i narzędzia wykonawcze | Połączyć istniejącego Worker Hosta i Fleet; testować rzeczywiste kontenery | Dwa izolowane sandboxy, build/test, timeout, cleanup, restart workera i związane receipts |
| P1 / G5: integracje MCP / Skills / Plugins / A2A | Połączyć istniejący katalog konfiguracji z rzeczywistymi adapterami w obecnym Runtime; określić wspierane protokoły | Discover → scoped grant → rzeczywisty tools/call → ToolReceipt → proof; odmowa bez grant; brak pozorowania niedostępnych protokołów |
| P0 / G6: limit kosztów i współbieżność | Współdzielony limit, idempotency key, rezerwacja kosztu, jawny stan niepewnego wyniku | Równoległe instancje respektują jeden limit; timeout nie powoduje automatycznego powtórzenia niepewnej operacji |
| P1 / G7: pełny odbiór UI | Uruchomić naprawione browser testy, desktop i Android, przepływy błędów i pozytywne; uzupełnić pozostałe teksty PL | Zielone wyniki dla dokładnego SHA PR; snapshot/fixture odróżniony od nowego wykonania; brak overflow i błędów aplikacji |
| P1 / G8: wydanie i pełny zakres | Jedna kanoniczna linia wydania, kompletne CI dla main/PR; sprawdzić przywracanie danych i rollback; osobno domknąć deklarowane Azure/Web3 live | Chroniony Preview na zatwierdzonym SHA, checklist release, dowód recovery i osobna decyzja o merge/deploy |

Kolejność wykonania: G1 + przegląd PR #18 → G2/G3/G6 → G4 → G5 → G7 → G8. Prace nad Azure/nowymi providerami nie powinny wyprzedzać prywatnej tożsamości, trwałego wykonania i jednego zamkniętego modelowego przepływu. Dokładny nakład wymaga wyników brakujących testów; ten audyt nie przypisuje arbitralnych godzin ani procentów.

To luki integracyjne i release gates, nie pozwolenie na przebudowę UI lub odblokowanie write Web3. Nie naprawia się ich usunięciem istniejących zabezpieczeń.

## NVIDIA — co wnosi katalog

Sprawdzono oficjalny katalog poleceniem `npx skills add nvidia/skills --list`: **424 pozycje**, bez instalowania skilli. Dla OSA trafne są dwa opcjonalne rozszerzenia, zweryfikowane na ich aktualnych SKILL.md:

- [nemo-relay-instrument-calls](https://github.com/NVIDIA/skills/tree/main/skills/nemo-relay-instrument-calls): spójne scope, lifecycle tool/LLM call, propagacja kontekstu i ścieżki błędów. Pierwszy prompt: „Porównaj READ-ONLY granice request/execution_id w osa-proof z NeMo Relay i wskaż minimalny adapter bez zmiany runtime”.
- [nemo-relay-plugin-observability](https://github.com/NVIDIA/skills/tree/main/skills/nemo-relay-plugin-observability): eksport jednego strumienia zdarzeń do ATOF/ATIF/OTLP. Pierwszy prompt: „Zaprojektuj READ-ONLY mapowanie istniejących zdarzeń OSA do jednego eksportera; sprawdź wersję Relay, sanitizację i flush przed implementacją”.

Polecenia do ewentualnego późniejszego zatwierdzenia (nie wykonano):

```bash
npx skills add nvidia/skills --skill nemo-relay-instrument-calls --agent codex --global --yes
npx skills add nvidia/skills --skill nemo-relay-plugin-observability --agent codex --global --yes
```

**Brak NeMo Relay nie jest blokerem wydania OSA.** Własne Runtime, eventy i proof pozostają źródłem prawdy. NVIDIA może pomóc w interoperacyjnej instrumentacji i eksporcie, ale nie zastąpi bramek G1–G8. Katalog umiejętności nie uruchamia GPU ani nie zapewnia dostępu do modelu.

## Następny konkretny krok

Po ocenie tego PR uruchomić jeden ograniczony test G1 na chronionym Preview: potwierdzony bezpłatny model, rzeczywiste tool_calls do SHA/runtime/worker, powiązany ProofReceipt i weryfikacja. Równolegle ustalić minimalny bezpieczny zakres przeniesienia trwałych poprawek z PR #18 do obecnego main; bez merge całego historycznego UI.
