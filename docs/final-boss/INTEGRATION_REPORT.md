# Raport integracji — częściowy

Baza OSA Proof `721cf8cfe7c2fd216fa2a993e5871b0faa26bcdf`; lokalna gałąź `integration/osa-proof-final-boss-e2e-20261028`. NeurOSA checkout `2f8eb8c910de246b8d2a027fbdef9180a098c928`. Prywatne repo Michael Angelo: bezpośredni clone wymaga uwierzytelnienia; odczyt package.json przez konektor działał, lecz nie zastępuje audytu integracji.

Wykonana zmiana: niezależny verifier sprawdza deklarowaną politykę dozwolonych executorów dla liniowej ścieżki TeamGraph. Test akceptuje dozwolony graf i odrzuca politykę wykluczającą executor. To kontrola zgodności deklaracji, nie dowód autentyczności wykonawcy ani rzeczywistej autoryzacji operatora.

`npm test`: 268 PASS, 0 FAIL, 3 SKIP (271 testów). `node --test dist/tests/mission-kernel.test.js`: 12 PASS, 0 FAIL. Wyniki obejmują fixture; nie dowodzą żądanej misji OSA-ULTIMATE-001. Raport testu: `evidence/mission-kernel-test.txt`.

CORE E2E: PARTIAL / misja z dashboardu przeszła na lokalnym NeurOSA; executory i sesja testowe, brak sandboxu. NEUROSA E2E: PARTIAL / izolowana lokalna instancja przeszła zapis i restart, brak produkcyjnego auth i trwałości. FULL PRODUCT: UNKNOWN / nie przeprowadzono kompletnego audytu. PRODUCTION READY: BLOCKED. Lokalna misja API ma identyfikatory w `evidence/local-live-neurosa.json`; nie jest pełnym scenariuszem dashboardowym. Brak preview. Wykonanie pozostaje sekwencyjne zgodnie z obecnym TeamGraph.

Aktualna aktywna ścieżka produkcyjnego SQLite nie została odczytana. Dockerfile NeurOSA podaje domyślne `/data/brain.db`; historyczny dokument opisuje wolumen `/persist` i brak zakończonego cutover. To nie jest dowód aktualnego stanu produkcji. Nie wykonano zmian produkcyjnych.

## Rzeczywista izolowana integracja — 28.10.2026

Wykryto błąd: adapter wysyłał ścieżkę `.json`, a NeurOSA NativeBrainWorkspace wymaga `.md`, przez co prawdziwy endpoint remember odpowiadał 500. Ścieżka `.md` naprawia integrację; zmiana nie modyfikuje NeurOSA. Uwaga: jeżeli inna implementacja upstream wcześniej zapisała zdarzenie z `.json`, ponowienie tego samego klucza z inną ścieżką może skutkować konfliktem idempotencji; nie wykonano migracji.

`scripts/final-boss-local-neurosa.cjs` uruchamia rzeczywisty lokalny BrainApiServer i SQLite z syntetycznymi danymi. Przeszły: remember → readback → restart procesu → recall i weryfikacja referencji; odmowa obcej organizacji i projektu przy skonfigurowanej pamięci; Mission API → native planner → dwa sekwencyjne testowe executory odczytujące realne README.md i package.json → evidence → ProofReceipt → zapis MissionRecord → restart obu serwerów → ponowny odczyt i brak ponownego wykonania; odmowa zmienionego lub brakującego evidence. Tożsamości są wstrzyknięte przez harness, executory nie mają izolowanego sandboxu, a ścieżka nie biegnie przez dashboard. Nie jest to pełny CORE E2E ani dowód produkcyjnego RBAC.

`scripts/verify-mission-record.cjs` w osobnym procesie sprawdził zapisany rekord pozytywnie oraz odrzucił kopię ze zmienionym MissionReceipt. Pliki dowodowe: `evidence/local-live-neurosa.json` i `evidence/local-live-neurosa-mission.json`. Record zawiera wyłącznie syntetyczny kontekst oraz hashe publicznych plików. Hash jest kontrolą integralności, a nie niezależną autentycznością źródła czy dowodem prawdziwości pracy.

## Spójność replay

Poprzedni verifier nie porównywał `run.events` z zapieczętowaną `timeline`; zmiana zdarzenia mogła przejść przy niezmienionych receiptach. Verifier porównuje teraz kolejność, identyfikatory, scope i projekcję payloadu; testy odrzucają zmienione i usunięte zdarzenie. Niezależna weryfikacja wcześniejszego zapisanego rekordu nadal przechodzi. To kontrola spójności, nie podpis ani ochrona przed całkowitym przeliczeniem i zastąpieniem całego rekordu.

## Izolacja projektu i test przeglądarki

Trasy `/teams`, `/missions/:id/*` i `/runs/:id/*` sprawdzają teraz również server-side `project_ids` zweryfikowanej tożsamości. Użytkownik innego projektu w tej samej organizacji otrzymuje 403; próba nadpisania identycznego klucza zespołu z innego scope otrzymuje 409. Test obejmuje create, read, plan, run, timeline, proof i evidence. Tożsamości `local-dev` i tryb open zachowują wyłącznie deweloperską semantykę, bez produkcyjnej gwarancji izolacji. Inne trasy nie były objęte tą poprawką.

`node scripts/test-unified-browser.cjs` z lokalnym Chromium przeszedł dla viewportów 390×844 i 1440×900. Scenariusz przez dashboard uruchamia rzeczywiste SHA-256, sprawdza receipt i otwiera replay UI. Wykorzystuje lokalny tryb open/fixture i ścieżkę Unified, bez NeurOSA i bez modelu; nie jest to dashboardowy Final Boss ani test na rzeczywistym telefonie. Wyniki: `evidence/browser-unified-results.json`. Po zmianie izolacji ponowiono test izolowanego NeurOSA; nowe identyfikatory znajdują się w `evidence/local-live-neurosa-project-scope.json`.

Regresja po zmianie: 269 PASS, 0 FAIL, 3 SKIP (272 testy). Dashboard TypeScript/Vite build PASS.

## Studio × lokalny NeurOSA — desktop i mobilny viewport

Dwa niezależne przebiegi `scripts/final-boss-browser-neurosa.cjs` uruchomiły istniejące Studio i właściwy Mission Kernel z prawdziwym BrainApiServer oraz SQLite. Operator wypełnia cel, wskazuje repozytorium `HazEOskA/osa-proof` i pliki `README.md` oraz `package.json`. Testowe executory odczytują tylko te dwa pliki sekwencyjnie; serwer odrzuca inny identyfikator repozytorium. Sesja jest wstrzyknięta przez harness: przetestowano 401 bez niej i 403 dla innego projektu, ale nie realnego dostawcy tożsamości.

Studio wyświetla Proof i oferuje **Pobierz zapis misji**. Test pobrał JSON i przekazał go kanonicznemu verifierowi; osobne polecenie CLI ponownie sprawdziło zapisane rekordy. Po kontrolowanym restarcie NeurOSA i odtworzeniu `FileMissionStore` test sprawdził zapis pamięci i receipt. Manipulacja evidence i niedozwolone repozytorium nie otrzymały VERIFIED. Wyniki: `evidence/browser-neurosa-result.json`, `evidence/browser-neurosa-mobile-result.json` i odpowiadające im rekordy.

Ograniczenia: brak Dockera, `bwrap` zakończył się błędem `open /proc/5/ns/ns`; testowi wykonawcy nie mają izolacji systemowej i nie są produkcyjną funkcją wyboru dowolnego repozytorium. To viewport mobilny Chromium, nie fizyczny telefon. W poprzednim przebiegu replay UI dla tej konkretnej misji nie był sprawdzony; kompletny pakiet artefaktów nie został sprawdzony; brak zewnętrznego zakotwiczenia, poświadczenia źródła oraz produkcyjnej trwałości. Dwa odczyty nie dowodzą jakości audytu repozytorium.

Komendy: build dashboardu `node scripts/build-dashboard.cjs`; lokalny test `NODE_PATH=<playwright> NEUROSA_CHECKOUT=<checkout> node scripts/final-boss-browser-neurosa.cjs`, wariant mobilny `OSA_BROWSER_VIEWPORT=mobile`. Regresja `npm test`: 269 PASS, 0 FAIL, 3 SKIP.

## Replay misji ze Studio

Studio przekazuje teraz dokładny TeamGraph, misję i wynik istniejącemu widokowi replay bez ponownego wywołania runtime. Etykieta źródła identyfikuje Studio. Rzeczywisty lokalny test przeglądarki na 1440×900 oraz 390×844: Studio → lokalny NeurOSA → dwa sekwencyjne testowe odczyty → download i verifier → replay tej samej misji, z krokiem RUN_VERIFIED. Wykonano kontrolowany restart magazynu misji i Brain API; odmowy i test manipulacji pozostają aktywne. Dowody: `evidence/browser-neurosa-replay-result.json`, `evidence/browser-neurosa-replay-mobile-result.json` i rekordy misji. `npm test`: 269 PASS, 0 FAIL, 3 SKIP; build dashboardu PASS.

Nadal: syntetyczna sesja, testowi executory bez sandboxu, brak produkcyjnej trwałości i zewnętrznej atestacji. Ten wynik nie potwierdza pełnego zakresu audytu repozytorium.

## Spójność kompletności replay po przeliczeniu hashy

W kontrolowanej kopii usunięto wszystkie eventy runtime i ich projekcję w timeline, odtworzono numerację oraz ponownie obliczono hash timeline i MissionReceipt. Poprzednie porównanie dwóch pustych list nie gwarantowało kompletności. Verifier sprawdza teraz wymagane eventy lifecycle, liniową kolejność agentów i handoffów, powiązania producentów oraz każdego evidence z eventem, operacją i wykonawcą, a także numerację i scope timeline. Odrzuca niekompletny replay nawet po ponownym obliczeniu kontrolnych hashy. Osobny test odrzuca timeline z obcym tenantem po przeliczeniu MissionReceipt.

Regresja: `npm test` 269 PASS / 0 FAIL / 3 SKIP. `node --test dist/tests/mission-kernel.test.js`: 12 PASS. Wcześniej zapisane rzeczywiste rekordy browser/NeurOSA nadal przechodzą verifier. To kontrola struktury i spójności; wszystkie dane wraz z niezakotwiczonymi hashami można nadal podrobić, więc pochodzenie wymaga zewnętrznego zakotwiczenia.
