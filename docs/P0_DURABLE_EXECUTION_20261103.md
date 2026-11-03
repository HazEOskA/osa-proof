# P0 Durable Execution — klient może zniknąć, misja nie powinna (2026-11-03)

## GOAL LOCK / scope
Naprawić sytuację, w której użytkownik na Androidzie/DeX lub desktopie wysyła prompt, zamyka kartę lub usypia ekran, a następnie nie ma odpowiedzi, stanu ani dowodu wykonania.

**Istniejąca gałąź:** integration/osa-proof-clean-baseline-20261102 (synchronizowana z main)
**PR:** #42 — bez merge do main i bez Production
**Zgoda:** tylko zmiany repo, testy/Preview; żadnych nowych zasobów w chmurze, sekretów ani konfiguracji.

## Rzeczywisty zakres implementacji
- Authenticated POST /durable/jobs: walidacja struktury, pełne scope organization/identity/project, unikalny execution_id, trwały rekord QUEUED zapisany przed potwierdzeniem 202.
- GET /durable/jobs/:execution_id: wynik, stan i identyfikatory tylko w granicach autoryzowanego scope.
- GET /durable/status: fail-closed, jeśli brak trwałego katalogu, osobnego aktywnego Workera albo Vercel Lambda.
- FileDurableJobStore: rekordy 0600, katalog 0700, synchronizacja zapisu, atomowe pliki statusu, blokada workera, odrzucanie ponownego POST tego samego ID z inną treścią.
- Oddzielny proces `npm run start:durable-worker`: obsługa QUEUED → RUNNING → COMPLETED/FAILED, zapis MissionKernel do FileMissionStore, budowanie artefaktów przez istniejący Proof Core.
- Worker's liveness heartbeat oraz RUNNING heartbeat; po utracie procesu rezultat może być UNKNOWN. **Brak automatycznego replay płatnej/nieidempotentnej misji**.
- Frontend przechowuje identyfikator wysłanej misji w historii klienta; zamknięcie karty nie powoduje cancel po stronie Workera. Po powrocie klient odpytuje GET i przywraca tekst odpowiedzi lub artefakt z Proof.
- W przypadku braku backendu Durable pokazuje w aplikacji ostrzeżenie; nie deklaruje gwarancji ciągłości zwykłej ścieżki.

## Testy bez płatnych wywołań
- tests/durable-execution.test.ts: file store restart, idempotency, tenant isolation, kontrole wejścia, jeden Worker, ProofReceipt artefaktu, uncertain RUNNING bez retry.
- scripts/test-durable-browser.cjs: realna lokalna aplikacja HTTP, **osobny worker w procesie OS**, zamknięta karta po HTTP 202, nowa karta tego samego browser context, odzyskany model i artefakt, szerokości Android 390 / desktop 1440.
- workflow: .github/workflows/durable-execution.yml na PR do main.
- Model testowy jest jawnie kontrolowanym generatorem (nie testem rzeczywistego providera).

## Ważne ograniczenia — żadnych fałszywych PASS
1. **Production Vercel: BLOCKED.** Nie ma zatwierdzonego współdzielonego trwałego magazynu ani długowiecznego Workera. Vercel Lambda nie może być udawanym durable workerem; endpointy Durable odmówią przyjęcia nowych zadań (HTTP 503).
2. **Gwarancja lokalna:** po zamknięciu przeglądarki proces Workera nadal działa. Po awarii tego procesu rekord jest zachowany, ale wykonanie w locie jest UNKNOWN (brak automatycznego restartu zewnętrznego modelu).
3. **Remember / NeurOSA:** zapis pamięci w trwałym trybie nie jest zaimplementowany; remember=true nie jest przyjmowane w durable POST. Włączony checkbox pamięci zachowuje dotychczasową ścieżkę, bez obietnicy odporności na zamknięcie karty.
4. **Unified tools i TRACE:** dotychczasowe endpointy pozostają synchroniczne; nie są jeszcze podłączone do Durable. Nie nazywać pełnego agentic runtime globally durable.
5. **Brak gwarancji cross-device:** aplikacja odzyskuje ID z localStorage tej samej przeglądarki. Serwer pozwala odczytać znane ID po poprawnym uwierzytelnieniu; nie ma jeszcze serwerowego indeksu historii dla wszystkich urządzeń.
6. **Koszt / global rate limits:** uruchomienie produkcyjne wymaga trwałego ledgeru limitów/cost budget i polityk. Lokalny demonstrator nie jest wystarczający do Production.
7. **Nieustalony los wywołania:** RUNNING bez heartbeat przechodzi w widoczne UNKNOWN; nie zachodzi automatyczny replay. Stary lock jest fail-closed i wymaga operator recovery.
8. **File durability** wymaga rzeczywiście trwałego shared volume. Lokalny /tmp, ephemeral disk Vercel, zwykły cache przeglądarki i pamięć procesu nie spełniają wymagań.

## Uruchomienie wyłącznie w już zatwierdzonym, własnym środowisku persistent server
Bez tworzenia nowej infrastruktury i bez dotykania Production. Użyj katalogu trwałego, współdzielonego między API i procesem Workera:
```bash
export OSA_DURABLE_DIR=/already-mounted-persistent-volume/osa-durable
npm run build
npm run start:durable-worker
```
Osobno wystartuj istniejący API server z tym samym OSA_DURABLE_DIR oraz poprawną autoryzacją/model provider. Worker nie korzysta z sesji przeglądarki ani streaming SSE. Ten przykład nie provisionuje wolumenu ani nie zatwierdza produkcyjnego użycia.

## Gate do przyszłego Production
Potrzebne odrębne Approval: typ magazynu z transakcjami i trwałym retention (np. Postgres), koszt i operacyjne retry policy, niezależny managed Worker (np. Cloud Run z osobnym schedulerem/queue), tenant authorization i sekret management, globalny concurrency/cost cap, realny end-to-end z zablokowanym telefonem oraz kontrola billing/logging. Do tego czasu PR powinien pozostać bez merge Production.

## Werdykt
CI local/browser może mieć PASS. **Production continuity = BLOCKED** aż do rzeczywistego durable backendu, jego deploymentu i weryfikacji. Bez nowych branchy.
