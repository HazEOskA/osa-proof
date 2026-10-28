# Raport integracji — częściowy

Baza OSA Proof `721cf8cfe7c2fd216fa2a993e5871b0faa26bcdf`; lokalna gałąź `integration/osa-proof-final-boss-e2e-20261028`. NeurOSA checkout `2f8eb8c910de246b8d2a027fbdef9180a098c928`. Prywatne repo Michael Angelo: bezpośredni clone wymaga uwierzytelnienia; odczyt package.json przez konektor działał, lecz nie zastępuje audytu integracji.

Wykonana zmiana: niezależny verifier sprawdza deklarowaną politykę dozwolonych executorów dla liniowej ścieżki TeamGraph. Test akceptuje dozwolony graf i odrzuca politykę wykluczającą executor. To kontrola zgodności deklaracji, nie dowód autentyczności wykonawcy ani rzeczywistej autoryzacji operatora.

`npm test`: 268 PASS, 0 FAIL, 3 SKIP (271 testów). `node --test dist/tests/mission-kernel.test.js`: 12 PASS, 0 FAIL. Wyniki obejmują fixture; nie dowodzą żądanej misji OSA-ULTIMATE-001. Raport testu: `evidence/mission-kernel-test.txt`.

CORE E2E: BLOCKED / nie wykonano misji z dashboardu. NEUROSA E2E: PARTIAL / izolowana lokalna instancja przeszła zapis i restart, brak produkcyjnego auth i trwałości. FULL PRODUCT: UNKNOWN / nie przeprowadzono kompletnego audytu. PRODUCTION READY: BLOCKED. Lokalna misja API ma identyfikatory w `evidence/local-live-neurosa.json`; nie jest pełnym scenariuszem dashboardowym. Brak preview. Wykonanie pozostaje sekwencyjne zgodnie z obecnym TeamGraph.

Aktualna aktywna ścieżka produkcyjnego SQLite nie została odczytana. Dockerfile NeurOSA podaje domyślne `/data/brain.db`; historyczny dokument opisuje wolumen `/persist` i brak zakończonego cutover. To nie jest dowód aktualnego stanu produkcji. Nie wykonano zmian produkcyjnych.

## Rzeczywista izolowana integracja — 28.10.2026

Wykryto błąd: adapter wysyłał ścieżkę `.json`, a NeurOSA NativeBrainWorkspace wymaga `.md`, przez co prawdziwy endpoint remember odpowiadał 500. Ścieżka `.md` naprawia integrację; zmiana nie modyfikuje NeurOSA. Uwaga: jeżeli inna implementacja upstream wcześniej zapisała zdarzenie z `.json`, ponowienie tego samego klucza z inną ścieżką może skutkować konfliktem idempotencji; nie wykonano migracji.

`scripts/final-boss-local-neurosa.cjs` uruchamia rzeczywisty lokalny BrainApiServer i SQLite z syntetycznymi danymi. Przeszły: remember → readback → restart procesu → recall i weryfikacja referencji; odmowa obcej organizacji i projektu przy skonfigurowanej pamięci; Mission API → native planner → dwa sekwencyjne testowe executory odczytujące realne README.md i package.json → evidence → ProofReceipt → zapis MissionRecord → restart obu serwerów → ponowny odczyt i brak ponownego wykonania; odmowa zmienionego lub brakującego evidence. Tożsamości są wstrzyknięte przez harness, executory nie mają izolowanego sandboxu, a ścieżka nie biegnie przez dashboard. Nie jest to pełny CORE E2E ani dowód produkcyjnego RBAC.

`scripts/verify-mission-record.cjs` w osobnym procesie sprawdził zapisany rekord pozytywnie oraz odrzucił kopię ze zmienionym MissionReceipt. Pliki dowodowe: `evidence/local-live-neurosa.json` i `evidence/local-live-neurosa-mission.json`. Record zawiera wyłącznie syntetyczny kontekst oraz hashe publicznych plików. Hash jest kontrolą integralności, a nie niezależną autentycznością źródła czy dowodem prawdziwości pracy.

## Spójność replay

Poprzedni verifier nie porównywał `run.events` z zapieczętowaną `timeline`; zmiana zdarzenia mogła przejść przy niezmienionych receiptach. Verifier porównuje teraz kolejność, identyfikatory, scope i projekcję payloadu; testy odrzucają zmienione i usunięte zdarzenie. Niezależna weryfikacja wcześniejszego zapisanego rekordu nadal przechodzi. To kontrola spójności, nie podpis ani ochrona przed całkowitym przeliczeniem i zastąpieniem całego rekordu.
