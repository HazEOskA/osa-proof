# P0 Unified Live Execution Trace — kontrakt i ograniczenia

**Goal:** każda wiadomość OSA (zwykła rozmowa, narzędzie, generowanie artefaktu) ma identyfikator wykonania i widoczny panel obserwacji. „Rozmowa” pozostaje rozmową; nie tworzy automatycznie artefaktu.

## Zakres — 2026-11-03

- NVIDIA conversation: POST /api/nvidia/fleet-live → SSE accepted, trace (context/model/evidence), complete albo error. Endpoint pozostawia dotychczasowy JSON /api/nvidia/fleet-chat dla zgodności. Oba mają timeout **180 000 ms**.
- Artifact: POST /api/chat/delivery → istniejące MissionKernel progress + trace, model_started/completed, complete/error; **nie** usuwa weryfikacji struktury HTML ani Proof Core.
- Shared UI: ten sam panel etapów, czasów, execution_id, źródła zdarzenia, pobierania trace JSONL / evidence JSON. Zachowany w istniejącej lokalnej historii IndexedDB wraz z wiadomością.
- Rozmowa nie tworzy ProofReceipt, bundle artefaktu ani pseudo-agentów. Evidence JSON jest opisem rzeczywiście zaobserwowanych zdarzeń i metadanych odpowiedzi, **nie kryptograficzną atestacją**.
- Komendy OSA w /unified/execute aktualnie zwracają JSON; panel prezentuje tylko lokalne „wysłano” i końcowy zweryfikowany wynik serwera. Nie twierdzi, że emitują pełne live kroki modelu.
- Durable Execution (w środowiskach z rzeczywistym durable backendem) nadal odzyskuje wynik z serwera, ale pełna historia stage-by-stage przy utracie łączności wymaga trwałego dziennika zdarzeń.
- Żaden etap nie ujawnia wewnętrznego rozumowania modelu, tokenów CoT ani tajnych danych.

## Przerwij — uczciwy model potwierdzeń

- POST /api/chat/live-cancel z execution_id + conversation_id; sesja po stronie API i zgodne pochodzenie (Origin) są wymagane.
- LiveExecutionRegistry wiąże execution_id z **organization_id + identity_id**, chroniąc przed anulowaniem cudzej misji.
- **CANCEL_REQUESTED**: sygnał AbortController został wysłany do aktywnego żądania w tej samej instancji API. To NIE jest potwierdzenie, że model zatrzymał przetwarzanie na NVIDIA.
- **CANCEL_UNCONFIRMED**: zadanie jest nieznane, już zakończone, żądanie anulowania nie trafiło do właściwej instancji, albo sygnał nie daje dowodu zatrzymania providera. Nigdy nie oznaczaj tego jako sukces.
- W ścieżce artefaktu AbortSignal jest przekazywany do funkcji NVIDIA, a po próbie przerwania wynik nie jest zatwierdzany jako gotowy bundle.
- Instance-only registry **nie daje gwarancji anulowania między replikami serverless**, ani po zamknięciu karty. Trwałe anulowanie wymaga persistent execution state i osobnego Workera (infrastruktura poza zakresem).

## Błędy i timeouty

- Backend emituje fazę failed lub cancel_unconfirmed z kodem błędu; klient zapisuje zdarzenia lokalnie w historii rozmowy.
- NVIDIA Timeout: 180 s w zwykłej rozmowie i artefaktach; Vercel maxDuration 240 s (osobny limit).
- Jeśli połączenie padnie przed potwierdzeniem, klient zapisuje obserwowany błąd; nie fabrykuje zakończonego model run.
- Po usunięciu danych przeglądarki lokalny trace może zniknąć; **brak server-side durable evidence ledger** w tym PR.

## Validation gate

1. Node/TypeScript tests: server HTTP SSE, scope, cancellation NVIDIA, artifact SSE cancellation bez fałszywego bundle.
2. Chromium 320/390/1440: czat live, pobranie trace, widoczny cancel, zapis historii/odświeżenie, istniejący artefakt + ProofReceipt.
3. GitHub 9/9 checks PASS na dokładnym HEAD.
4. Merge i automatyczny Production wyłącznie po CI + E2E PASS, bez zmian auth/secret/cost/infrastructure, zgodnie z zatwierdzeniem operatora.

**Scope lock:** wyłącznie live trace, 180 s NVIDIA, kontrola anulowania i ich testy. Bez nowych gałęzi, nowej infrastruktury i modyfikacji innych repozytoriów.
