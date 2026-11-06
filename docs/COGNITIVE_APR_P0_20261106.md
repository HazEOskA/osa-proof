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
- Delivery Lab używa tego samego obiektu `kernel.brain`. Unified używa wskazanego przez serwer `state.missionKernel`.

## Granice uczciwego dowodu
- Sam `PlanningReceipt` nie oznacza poprawności rozumowania.
- `APR VERIFIED` dotyczy obsługiwanych wymagań i twierdzeń; nie oznacza prawdziwości dowolnej analizy prawnej, ekonomicznej czy historycznej.
- `raw_response` jest niezaufaną treścią modelu. Przy błędzie traktuj ją jako materiał audytowy, nie rekomendację.
- Na Vercel `MissionStore` jest procesowy. Pobranie JSON na urządzenie nie jest trwałym magazynem serwerowym ani niezależną atestacją.
- Konfiguracja `OSA_BRAIN_MODE=model` może wykonać osobne wywołanie modelu do planowania; to dodatkowy koszt/latencja. Tryb `native` tworzy strukturalny plan bez modelowego rozumowania.
- Planowanie Brain nie ma obecnie pełnego abort; przy utracie połączenia nie należy deklarować potwierdzonego zatrzymania dostawcy.
- NeurOSA pozostaje opcjonalna. Dodatkowe odczyty kontekstu muszą zostać zmierzone i zweryfikowane przed produkcyjnym GO.

## Konieczne testy przed GO
1. Pełne `npm test` + dashboard build + regresje przeglądarkowe.
2. Test, że odrzucenie planowania nie uruchamia NVIDIA.
3. Test `BLOCKED`: surowa odpowiedź, SHA-256, identyfikator i eksport JSON muszą być zgodne.
4. Test prawidłowej odpowiedzi (bez fałszywego BLOCKED) oraz nieobsługiwanych twierdzeń (bez fałszywego „prawda zweryfikowana”).
5. Kontrola auth / tenant isolation, anulowania i limitów bez wywołań produkcyjnych.
6. LIVE E2E po osobnej zgodzie; bez samoczynnego merge.

Nie używać statusu `E2E PASS` bez faktycznego testu w przeglądarce z modelowym wywołaniem.
