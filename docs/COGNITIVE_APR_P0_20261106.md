# OSA Proof — Cognitive / APR P0, gałąź testowa

## Cel i zakres
Jeden obowiązkowy kontrakt `Brain.plan -> MissionKernel.execute -> OsaRuntime/APR` dla:
- Jeverson / NVIDIA chat,
- `/unified/execute` (narzędzia),
- generowania artefaktów przez Delivery Lab.

Istniejące BrainControlPlane, MissionKernel, OsaRuntime i Proof Core są wykorzystywane ponownie. Bez tworzenia drugiego silnika i bez zmiany produkcji przed osobną decyzją.

## Zachowanie
- Chat tworzy prawdziwą, jednowęzłową misję z przypisanym zakresem organizacji/projektu. Bez `PlanningReceipt` wykonawca nie ma prawa wywołać NVIDIA.
- APR ocenia dowody wykonania i obsługiwane twierdzenia. Odrzucenie nie jest mylone z odpowiedzią `VERIFIED`.
- Przy `BLOCKED` strumień SSE przekazuje do uprawnionej przeglądarki `osa.chat_review.v1` z oryginalną odpowiedzią, SHA-256, identyfikatorami misji/wykonania, werdyktem i istniejącymi dowodami APR.
- UI pokazuje materiał jako **ODRZUCONĄ, NIEZWERYFIKOWANĄ ODPOWIEDŹ**, z lokalnym pobraniem JSON.
- Delivery Lab, chat i Unified korzystają z tego samego skonfigurowanego **plannera Brain** i magazynu misji; adapter pamięci nie jest ponownie wywoływany w planowaniu. Dostęp do NeurOSA zachowuje istniejące, autoryzowane `MemoryService`.

## P0 — odbiór treści i pełny eksport dowodów
- W czacie **oddzielne** statusy: \`execution_verdict\` oznacza kontrolę wykonania APR; \`content_assurance.verdict\` oznacza zakres faktycznej kontroli treści.
- \`UNVERIFIED\` jest obowiązkowe, gdy brak niezależnych źródeł dla twierdzeń merytorycznych. \`PARTIALLY_CHECKED\` dotyczy wyłącznie rozpoznanego rachunku Commerce Gate; pozostałe twierdzenia nadal nie są zweryfikowane.
- Dla przyjętej odpowiedzi serwer wysyła \`osa.chat_audit.v1\` w sesji SSE, w tym \`PlanningReceipt\`, \`ProofReceipt\`, evidence/observations/tool calls, oryginalne \`final_output\`, SHA-256 oraz zakres kontroli.
- UI oznacza widocznie, że **zweryfikowane wykonanie nie dowodzi prawdziwości analizy** i udostępnia \`*-apr-audit-bundle.json\` do pobrania.
- \`memory_assurance\` odróżnia \`CONTEXT_USED\`, \`NO_CONTEXT\`, \`UNAVAILABLE\` i \`UNCONFIGURED\`. \`CONTEXT_USED\` dotyczy kontekstu przekazanego NVIDIA, nie oznacza użycia pamięci przez planner.
- Pełny test NeurOSA/OAuth wymaga zalogowania na kanonicznym adresie produkcyjnym po zatwierdzonym merge. Preview nie jest równoważne produkcyjnemu OAuth; nie przełączać ani kopiować tokenów.
- To jest rozdzielenie dowodu i prawdziwości, nie automatyczny analizator wszystkich przepisów, faktów czy rekomendacji.

## Granice uczciwego dowodu
- Sam `PlanningReceipt` nie oznacza poprawności rozumowania.
- `APR VERIFIED` dotyczy obsługiwanych wymagań i twierdzeń; nie oznacza prawdziwości dowolnej analizy prawnej, ekonomicznej czy historycznej.
- `raw_response` jest niezaufaną treścią modelu. Przy błędzie traktuj ją jako materiał audytowy, nie rekomendację.
- Na Vercel `MissionStore` jest procesowy. Pobranie JSON na urządzenie nie jest trwałym magazynem serwerowym ani niezależną atestacją.
- Konfiguracja `OSA_BRAIN_MODE=model` może wykonać osobne wywołanie modelu do planowania; to dodatkowy koszt/latencja. Tryb `native` tworzy strukturalny plan bez modelowego rozumowania.
- Planowanie Brain nie ma obecnie pełnego abort; przy utracie połączenia nie należy deklarować potwierdzonego zatrzymania dostawcy.
- NeurOSA pozostaje opcjonalna. P0 unika podwójnego recall, więc sam PlanningReceipt nie poświadcza użycia pamięci przez planner. Powiązanie kontekstu z planem semantycznym należy do dalszego etapu, po testach zakresów tenantów.

## Konieczne testy przed GO
1. Pełne `npm test` + dashboard build + regresje przeglądarkowe.
2. Test, że odrzucenie planowania nie uruchamia NVIDIA.
3. Test `BLOCKED`: surowa odpowiedź, SHA-256, identyfikator i eksport JSON muszą być zgodne.
4. Test prawidłowej odpowiedzi (bez fałszywego BLOCKED) oraz nieobsługiwanych twierdzeń (bez fałszywego „prawda zweryfikowana”).
5. Kontrola auth / tenant isolation, anulowania i limitów bez wywołań produkcyjnych.
6. LIVE E2E po osobnej zgodzie; bez samoczynnego merge.

Nie używać statusu `E2E PASS` bez faktycznego testu w przeglądarce z modelowym wywołaniem.
