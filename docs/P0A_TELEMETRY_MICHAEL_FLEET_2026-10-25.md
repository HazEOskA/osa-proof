# P0-A — wspólna telemetryka OSA i Michael Angelo Fleet (25.10.2026)

## GOAL LOCK
Jedna spójna korelacja `execution_id` pomiędzy API, Workerem, Runtime i opcjonalnym adapterem Michael Angelo; bez nowego control plane i bez wykonywania zmian w innych repozytoriach.

## Kontrakt
- `osa.telemetry.v1` — osobny, ustrukturyzowany JSON na wyjściu stdout.
- Wspólne pola: `timestamp`, `component`, `event`, `execution_id` (tylko poprawny format), `run_id`, `mission_id`, `request_id`, `status_code`, `duration_ms`, `outcome`.
- Redakcja: nie logować promptów, body żądań, nagłówków autoryzacyjnych, zmiennych środowiskowych, tokenów, credentiali, stderr lub danych dowodowych. Wyłącznie jawnie dozwolone pola.
- Runtime loguje zdarzenia po ich zapisie. Awaria sinka telemetrycznego nie może zmienić wyniku wykonania; ProofReceipt pozostaje osobnym mechanizmem.
- API generuje wpis przy zakończeniu odpowiedzi, dopisując `x-osa-execution-id` do odpowiedzi wtedy, gdy wynik ma prawidłowy `execution_id`.
- Worker raportuje status HTTP po zakończeniu. Nagłówek `x-osa-execution-id` jest akceptowany wyłącznie w poprawnym formacie (nie jest dowodem uwierzytelnienia).

## Michael Angelo — granica rzeczywistej integracji
Zamierzony upstream: `HazEOskA/michael-angelo-kernelxver5/RUNTIME_BACKEND_CONTRACT.md`, **nie** frontend `michael-angelo-pro`.
Istniejący kontrakt opisuje `GET /v1/status`, `POST /v1/missions`, `POST /v1/missions/{id}/transition`, `GET /v1/missions/{id}`. Adapter:
- rejestruje się w istniejącym `ExecutorRegistry` jako `michael-angelo.worker.v1`, co pozwala TeamGraph / Mission Kernel używać go jako roli agenta;
- wymaga jawnego serwerowego opt-in `OSA_MICHAEL_ANGELO_ENABLED=true` **oraz** `OSA_MICHAEL_ANGELO_BASE_URL` i `OSA_MICHAEL_ANGELO_TOKEN` (token minimum 32 znaki);
- domyślnie planuje tryb `ARCHITECT`; opcjonalny `OSA_MICHAEL_ANGELO_MODE=PAINTER` wymaga świadomej decyzji operatora;
- akceptuje HTTPS lub HTTP wyłącznie na localhost/127.0.0.1; nie stosuje automatycznych retry mutacji;
- pobiera status, tworzy misję, przełącza do `QUEUED`, odpytuje do stanu terminalnego lub timeoutu; błędy i nieznane stany przerywają operację;
- nigdy nie deklaruje niezależnego dowodu poprawności pracy zewnętrznego agenta: `verification_scope=REMOTE_SELF_REPORT_UNVERIFIED`.

**Ważne:** `VERIFIED` z lokalnego OSA Proof dotyczy integralności lokalnego receipt oraz spełnienia zadeklarowanych wymagań, nie niezależnej walidacji semantycznej pracy upstream. Michael Angelo jako samodzielny worker floty z własnym lease/heartbeat **nie został** podłączony — wykorzystuje kontrakt zewnętrznego executora działającego wewnątrz istniejącego Fleet/TeamGraph. Żadnych zmian zdalnego backendu ani konfiguracji nie wykonano.

## Testy i dowody
- `tests/telemetry.test.ts`: format schema, korelacja, redakcja, obsługa błędów sinka i zakończenie HTTP.
- `tests/michael-angelo-fleet.test.ts`: rzeczywisty HTTP do kontrolowanego lokalnego serwera, ścieżka status→mission→queue→complete, powiązanie `execution_id` i ProofReceipt, negatywne przypadki oraz brak automatycznego retry.
- Komenda akceptacyjna: `npm ci && npm test`.
- CI / live Michael Angelo / realny backend: **UNKNOWN, dopóki nie ma wyniku**. Fixture z kontrolowanym lokalnym HTTP nie jest dowodem pracy prawdziwego zdalnego agenta.
- Brak merge, deployu, płatnego modelu i zmian innych repozytoriów.

## Następne bramki (poza zakresem tego PR)
1. Operator potwierdza rzeczywistą adresowalność i autoryzację Michael Angelo Backend API.
2. Jedna misja testowa live z identyfikatorami i zewnętrzną weryfikacją ledgeru / artefaktów, bez niejawnych retry.
3. Po PASS osobny projekt trwałego leasingu i heartbeat, bez rozbudowy poza kanoniczny Fleet.
