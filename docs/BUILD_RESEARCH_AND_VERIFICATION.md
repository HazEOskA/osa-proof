# Build — przegląd przed pushem

Cel: dziewięć ekranów Build w istniejącym dashboardzie OSA, z konfiguracją
TeamGraph i wykonaniem misji przez obecny runtime i canonical Proof.

Baza odczytana z GitHub: feature/osa-dashboard-live-control-plane,
642fa24a62124095605238a9e555b84a16dc6d70. Nie wykonano commit, push, merge ani deploy.

## Źródła i decyzje

- Langflow: rozdzielenie edytora i testów Playground.
  https://docs.langflow.org/concepts-overview
  https://docs.langflow.org/concepts-playground
- AutoGen Studio: składanie zespołów z komponentów i testowanie w Playground.
  https://microsoft.github.io/autogen/stable/user-guide/autogenstudio-user-guide/usage.html
- LangSmith Studio: graf, wejścia, wyniki i debugowanie wykonania.
  https://docs.langchain.com/langsmith/studio
- Dify: wgląd w wejścia, wyjścia i metadane wykonania poszczególnych kroków.
  https://dify.ai/blog/dify-1-5-0-real-time-workflow-debugging-that-actually-works
- n8n: workflow jako zasób wielokrotnego użycia dla narzędzi.
  https://n8n.io/workflows/2713-using-external-workflows-as-tools-in-n8n/

Implementacja zachowuje istniejące ikony, motyw i nawigację OSA.
Nie dodaje nowego silnika orkiestracji. Graf jest liniowy zgodnie z runtime.

## Ekrany

| Sekcja | Gotowy interfejs | Granica |
| --- | --- | --- |
| Agenci | lista, wyszukiwanie, edycja, przypisania, wykonania | agent jest węzłem TeamGraph; dostępność executor_ref potwierdza wykonanie |
| Agent Mesh | mapa, inspektor, handoff, walidacja | bez rozgałęzień i cykli |
| Workflowy | widok kroków i połączeń, przejście do Studio | aktualny TeamGraph; bez osobnego schedulera |
| Narzędzia | definicje, konfiguracja, wersje, przypisania | task i requested_operation przekazywane do istniejącego Execution Force |
| Skille | procedury, parametry, wersje, przypisania | instrukcja procedury w task, capability RUN_TOOL |
| MCP / A2A | konfiguracja i diagnostyka obsługi protokołu | oba klienty UNSUPPORTED; brak pozornego połączenia |
| Prompty | edytor, zmienne, podgląd, wersje, przypisania | prompt dołączany do wejścia misji; interpretacja zależy od wykonawcy |
| Studio | brief, zespół, capability, wejście, kryteria, przegląd | używa istniejących POST teams/missions/run |
| Playground | test, wynik, events, evidence, receipt | zdarzenia zwracane po zakończeniu; bez streamingu |

Konfiguracja jest zapisywana lokalnie jako jawny szkic oraz przez
GET/POST /build/workspace do tej samej pamięci procesu co ApiState.
GET /build/status pokazuje tryb wykonania i brak obsługi protokołów.
Nie jest to trwała baza; zimny start może utracić konfigurację API.
Sekrety w konfiguracji są odrzucane; konektor przechowuje tylko credential_ref.
Endpointy Build dziedziczą obecny model dostępu API; nie dodano uwierzytelniania.
Domyślne kryterium artifact.status=built należy dopasować do konkretnej misji.

## Weryfikacja

- Frontend: TypeScript + Vite build PASS.
- Backend slice: kompilacja tsconfig.build-slice.json PASS.
- Build, integration adapters i integralność Proof: 22 PASS / 0 FAIL.
- Przeglądarka: wszystkie 9 ekranów desktop i mobile, 18 zrzutów, bez pageerror
  i bez poziomego przepełnienia przy szerokości 412 px.
- UI -> rejestracja TeamGraph -> misja -> runtime fixture -> evidence ->
  canonical osa.proof_receipt.v2: VERIFIED.
- Podstawianie zmiennych promptu i zapis konfiguracji przez UI: PASS.
- Zewnętrzne Builder/Execution Force/LLM: live UNKNOWN, nie uruchomiono.

Pełne npm test NIE jest zielone: Identity i SessionRecord nie są eksportowane
z bazowych contracts. Po selektywnej kompilacji szerszy zestaw daje 45 PASS,
4 FAIL i 1 SKIP; stare testy auth oczekują nieobecnych endpointów, a test
selektora oczekuje poprzedniego HTML. Te same błędy potwierdzono na bazie
642fa24a, bez zmian Build. Nie naprawiano auth ani selektora poza zakresem.

## Lokalny podgląd

Backend: npm ci; npx tsc -p tsconfig.build-slice.json;
OSA_EXECUTION_MODE=fixture PORT=3111 node dist-build/apps/api/src/server.js

Frontend: cd dashboard-src; npm ci; npm run dev

Testy: node --test dist-build/tests/build-workspace.test.js
dist-build/tests/integration-slice.test.js dist-build/tests/proof-integrity.test.js

Kod dashboard-src jest preferowany przez scripts/build-dashboard.cjs;
archiwum vendor pozostaje fallbackiem dla starszych checkoutów.

STOP przed pushem. Podgląd jest gotowy do oceny; pełnego V0.1 live nie zamknięto.
