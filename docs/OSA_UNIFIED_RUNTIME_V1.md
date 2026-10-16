# OSA Unified Runtime V1 — integracja preview

Cel: normalny czat istniejącego Jeversona → rzeczywiste narzędzie OSA → zdarzenia → evidence → receipt → niezależne przeliczenie integralności w Jeversonie i przeglądarce OSA Proof.

## Wykorzystane implementacje

- Fleet Chat: istniejący ekran Jeversona, Tracing, Proofs, transport Fleet i testy SSE.
- Mastra: zachowany adapter delegowania misji i istniejące testy.
- Native Builder: odzyskane `packages/builder-core` z gałęzi Azure, dopasowane do aktualnego zakresu worker hosta; executor `osa.native-builder.v1` zarejestrowany w runtime.
- Worker host i workspace runtime: zachowane nowsze zabezpieczenia main, bez cofania do starszych implementacji. Odzyskane pliki deploy nie zostały uruchomione.
- Jeverson: osobna gałąź oparta na `feature/jeverson-neurosa-memory-slice2`; Hermes, JEV, worker registry i NeurOSA zachowują dotychczasowe ścieżki.

## Rzeczywiste zadania w normalnym czacie

| Wiadomość | Narzędzie | Efekt |
| --- | --- | --- |
| `Oblicz SHA-256 tekstu: OSA Unified Runtime V1` | `osa.crypto.sha256.v1` | Rzeczywiste obliczenie Node crypto przez executor OsaRuntime |
| `Sprawdź status runtime OSA Proof` | `osa.runtime.inspect.v1` | Dwa rzeczywiste GET do API aktualnego preview |
| `Pokaż status workera` | `osa.worker.health.v1` | GET istniejącego worker hosta, jeśli skonfigurowany; inaczej BLOCKED |
| `OSA zbuduj aplikację` | gate preview | BLOCKED; brak płatnego modelu, powłoki i mutacji repo |

Routing tych narzędzi jest deterministyczny i jawnie oznaczony. Nie jest przedstawiany jako tool calling modelu JEV. Pozostałe rozmowy i wybrani workerzy LLM nadal korzystają z istniejącego runtime Jeversona.

## Powiązanie i weryfikacja

Jeverson tworzy jeden `execution_id`; OsaRuntime używa go bez zmiany w executorze, zdarzeniach, evidence i receipt. Kompletne wykonanie jest przenoszone do istniejącej projekcji OSA Proof przez wiadomość z osadzonego Jeversona. OSA Proof sprawdza dokładny origin, okno iframe, identyfikatory i hashe przed przyjęciem wykonania.

Wiadomość i wynik zachowują eksport receipt z kompletnym bundle. Hashy nie należy traktować jako zewnętrznej atestacji prawdziwości danych. Snapshot runtime na Vercel pozostaje w pamięci procesu; eksportowany bundle można weryfikować po utracie tego procesu.

## Walidacja i ograniczenia

Lokalny browser E2E używa prawdziwego Next.js, OSA HTTP API i OsaRuntime. Brak podmian fetch i odpowiedzi narzędzi; brak płatnych wywołań modelu. Desktop 1440×900 i mobile 390×844: normalny czat → narzędzie crypto → Tracing → Proofs, bez błędów JS. Zapis dowodów: `docs/evidence/unified-v1-local-browser.json`.

Native Builder jest zintegrowany i zablokowany bez jawnego `OSA_NATIVE_BUILDER_EXECUTION=enabled`; ten run go nie uruchamia. Realny build przez Claude/Codex wymaga providera, uprawnień i działającego izolowanego workera. Nie twierdzimy, że odczyt `/health` dowodzi działania Dockera lub wykonania zadania build.

NeurOSA i Hermes nie są zastępowane. Ich zdalne działanie wymaga istniejącej konfiguracji i autoryzacji operatora; nie jest dowiedzione samym testem narzędzia crypto. Main, produkcja i pozostałe repozytoria nie są zmieniane.

## Lokalne sprawdzenie

`npm test`, `npm run worker:build`, testy adaptera Mastra. Dla browser E2E zbuduj dashboard z `VITE_OSA_LOCAL_E2E=1 VITE_OSA_JEVERSON_URL=http://127.0.0.1:3101`, Jeversona z `NEXT_PUBLIC_OSA_PROOF_ORIGIN=http://127.0.0.1:3100`, następnie uruchom `npm run test:unified:browser`. `JEV_ROOT` wskazuje checkout integracyjny, a `OSA_CHROMIUM_PATH` lokalne Chromium. Test sam uruchamia oba serwery w tej samej sieci lokalnej.

## Potwierdzone preview w chmurze

Preview: https://osa-proof-git-feature-osa-unifie-785394-osabarca-1680s-projects.vercel.app/

Normalny czat → `osa.runtime.inspect.v1` → dwa rzeczywiste HTTP 200 → Tracing → Proofs: potwierdzone w przeglądarce. Execution `exec_b288585e-573f-43ad-8217-d33fb6b0be72`, niezależne przeliczenie 9/9 MATCH. Brak worker hosta został sprawdzony osobno w normalnym czacie: BLOCKED / WORKER_NOT_CONFIGURED, bez fałszywego sukcesu.

Backend: 219 PASS / 0 FAIL / 3 SKIP. Mastra: 15 PASS / 0 FAIL. Jeverson, Hermes, NeurOSA i nowe gate: 25 PASS / 0 FAIL. Build backendu, worker hosta, dashboardu i Next.js: PASS. Mobile to lokalny test przeglądarki 390×844; chmura została sprawdzona dodatkowo w przeglądarce desktop.

Preview Jeversona nie ma providerów JEV/NVIDIA/OpenRouter ani konfiguracji NeurOSA; zwykłe rozmowy generatywne, Hermes z modelem i workerzy LLM pozostają bez aktywnego providera. To rzeczywiste blokady pełnego mandatu. Deterministyczne narzędzia OSA działają bez modelu. Backend nadal zawiera historyczny tryb fixture dla istniejących scenariuszy; snapshot jest wyraźnie oznaczony i nie jest przedstawiany jako nowe wykonanie.

Konfiguracja połączenia dotyczy wyłącznie `preview` oraz `feature/osa-unified-runtime-v1`. Dostęp publiczny jest wyjątkiem przypiętym do nowego wdrożenia Jeversona, nie zmianą globalnych zabezpieczeń projektu. Produkcja i main pozostają bez zmian. Szczegóły: `docs/evidence/unified-v1-cloud.json`, obraz: `docs/evidence/unified-v1-cloud-proof.jpg`.
