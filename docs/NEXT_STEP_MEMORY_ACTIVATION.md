# M1 — aktywacja NeurOSA Memory i trwałego stanu Mission

## Cel i granica

Przygotowany następny krok po kodzie S1–S5. Dokument jest planem implementacji, nie dowodem aktywnej Memory ani nową wersją produktu.

Cel: Mission A → rzeczywiste wykonanie/proof → trwały zapis wyniku do istniejącej NeurOSA → restart procesu OSA → Mission B → recall z provenance Mission A → PlanningReceipt z digestem rzeczywistego kontekstu.

Istniejące MissionKernel, OsaRuntime, MissionStore, BrainControlPlane i NeurOSA pozostają jedynymi źródłami swoich domen. Nie tworzymy drugiego frameworka ani kopii magazynu NeurOSA.

## Potwierdzony stan bazowy

Baza kodu: `219ef09d734a92b37ba3e3c786c8d2054754c05a`.

Odczyt publicznego `/api/build/status` przez connector Vercel 2026-09-30 14:24 UTC: HTTP 200, `mode=fixture`, `auth_mode=open`, `mission_persistence=PROCESS_MEMORY`, `brain.memory=NONE`. Wcześniejszy pojedynczy odczyt curl zwrócił 503; przyczyna UNKNOWN. Ponowny odczyt nie wykazał stałej niedostępności.

| Fakt | Evidence |
|---|---|
| Istnieje adapter recall NeurOSA, opcjonalnie konfigurowany pięcioma zmiennymi | [NeurosaMemoryAdapter / createConfiguredBrain](../packages/adapters/src/brain.ts) |
| BrainMemory ma wyłącznie kontrakt recall | [BrainMemory](../packages/contracts/src/brain.ts) |
| Brain plan zapisuje kontekst oraz memory_context_sha256 do PlanningReceipt | [BrainControlPlane.plan](../packages/brain/src/index.ts) |
| Domyślny native planner kompiluje graph; nie dowodzi semantycznego wykorzystania pamięci | [NativeBrainPlanner.propose](../packages/brain/src/index.ts) |
| MissionStore ma memory i lokalny filesystem, oba z kontrolą revision | [MissionStore / MemoryMissionStore / FileMissionStore](../packages/runtime/src/mission-store.ts) |
| Vercel przekazuje undefined jako MissionStore, czyli używa pamięci procesu | [handler](../api/osa.ts) |
| Teams, runs, queue i sessions również zawierają stan procesu | [ApiState](../apps/api/src/index.ts) |
| Numer 0.5-local-review jest etykietą wpisaną w kodzie | [PlatformControlPlane.describe](../packages/platform/src/index.ts) |

Nie wolno utożsamiać trwałości Mission z trwałością całego control plane.

## Istniejący kontrakt upstream do reuse

Odczytany kod NeurOSA na commicie `a29b973d4c67c238c2e5818d7e65ad3ed3e0c52d`:
[BrainApiServer.route / memorySchema](https://github.com/HazEOskA/neurosa-human-brain/blob/a29b973d4c67c238c2e5818d7e65ad3ed3e0c52d/packages/neurosa-brain-api/src/index.ts).

- GET `/api/v1/brain/status`: scope `brain:read`, brainId i raport ledger.
- POST `/api/v1/brain/recall`: scope `memory:read`; includeCore wymaga także `brain:read`; odpowiedź zawiera brainId, ledgerValid i context.
- POST `/api/v1/brain/remember` i `/api/v1/brain/observe`: scope `memory:write`; wykonują istniejące `knowledge.write`.
- `memorySchema` jest strict. Obsługuje title, content, projectId, kind, idempotencyKey, expectedRevision, factKey i source. Nie obsługuje osobnych pól organization_id ani mission_id.
- Misja i tenant muszą być zapisane w kontrolowanym payloadzie content/provenance. Nie dodajemy nieobsługiwanych pól do body.
- source.type przyjmuje GOOGLE_DRIVE, FILE, CHAT_EXPORT albo SESSION. Nie wymyślamy typu MISSION.
- Sam endpoint remember nie dowodzi trwałości procesu NeurOSA ani poprawności deduplikacji. Przed implementacją zapisu trzeba odczytać `SharedKnowledge.write`, repository/backend i testy na faktycznie wdrażanym commicie. Aktualny commit usługi live: UNKNOWN.

Recall jest globalny w danym brain. Obecny adapter wymaga dedykowanego brain dla jednej organizacji i projektu. projectId w dokumencie nie stanowi dowodu izolacji upstream.

## Kolejność implementacji

1. **Prawdziwy status i wymagane zależności.** Rozdzielić etykietę zakresu od gotowości. Status Memory: UNCONFIGURED / CONFIGURED_UNVERIFIED / VERIFIED / UNAVAILABLE, oparty na konfiguracji i ostatnim scoped probe z timestampem. W profilu wymagającym Memory brak adaptera lub błędny probe blokuje planowanie; nie przełącza na NONE.
2. **Granica dostępu przed aktywacją.** Zamknąć dostęp open do danych z realnej Memory. Zweryfikować tożsamość oraz membership organization/project na read, plan, run, receipt, recall i write. Publiczny dev-login nie może nadawać produkcyjnego dostępu. Sam OSA_AUTH_MODE=session nie dowodzi takiej autoryzacji.
3. **Trwały MissionStore.** Wdrożyć provider-neutral adapter do trwałej bazy z atomowym CAS. PostgreSQL jest rekomendacją ze względu na transakcje; istniejący dostawca/baza i credential: UNKNOWN, do ustalenia przed konfiguracją. Nie tworzyć automatycznie kolejnej bazy. Reuse MissionRecord, checksum i verifier. Unikalność mission_id, create-only i revision muszą być egzekwowane w DB. /tmp Vercel ani FileMissionStore nie są trwałym backendem serverless.
4. **Readiness i recall live.** Podłączyć istniejący adapter do prawdziwego NeurOSA. Zapisać w planie rzeczywiste brain_id, ledger_head, references, scope i context_sha256. Dowód musi pochodzić z realnego endpointu, nie HTTP stubu. Native planner pozwala dowieść odczytu/snapshotu; semantyczne użycie kontekstu przez model wymaga osobnego testu model Brain i nie jest zakładane.
5. **Trwały outbox i zapis do upstream.** Po zweryfikowanym execution generować minimalną, oczyszczoną obserwację z Mission/proof/reflection. Stabilny idempotencyKey wyprowadzić z scope, typu obserwacji i MissionReceipt SHA. Transakcja lokalna zapisuje rekord learning/outbox; dispatcher używa istniejącego remember/observe i sprawdzonego upstream kontraktu. Nie oznaczać ACKNOWLEDGED po samym wysłaniu requestu. Timeout po możliwym zapisie wymaga deduplikacji/reconciliation.
6. **Dowód między dwiema Mission.** Odzyskać Mission A po restarcie OSA, potwierdzić zachowanie danych po restarcie NeurOSA zgodnie z jego backendem, następnie odczytać jej unikalną obserwację przy planowaniu Mission B. Przypiąć digest kontekstu i source references w PlanningReceipt. Dopiero wtedy raportować odpowiednią capability Memory jako VERIFIED.

Outbox, MemoryWriteReceipt i zdarzenia learning są odrębnymi rekordami powiązanymi z mission_id i MissionReceipt SHA. Nie dopisywać ich do już zapieczętowanego timeline COMPLETED Mission ani nie zmieniać jej MissionReceipt.

## Dokładna mapa planowanych zmian

| Plik / moduł | Planowana zmiana |
|---|---|
| packages/contracts/src/brain.ts | Kontrolowany kontrakt write, MemoryWriteReceipt i probe; zachować istniejący recall |
| packages/runtime/src/mission-store.ts | Konfiguracja trwałego backendu i zachowanie CAS; zgodność memory/file |
| packages/runtime/src/postgres-mission-store.ts — nowy | Adapter SQL za istniejącym MissionStore; provider DB poza core |
| packages/runtime/sql/mission-memory.sql — nowy | Wersjonowana migracja snapshotów Mission, indeksu run_id i learning/outbox |
| packages/runtime/src/mission-memory-outbox.ts — nowy | Trwałe pending/ack/reconciliation, tenant i receipt binding |
| packages/adapters/src/mission-store.ts — nowy | Jedna fabryka konfiguracji dla Node i Vercel, fail closed |
| packages/adapters/src/brain.ts | Reuse bounded HTTPS request, scoped probe oraz pamięciowe remember/observe |
| packages/brain/src/index.ts | Probe/status; actual recall evidence; bez automatycznego learning claim |
| packages/runtime/src/mission-kernel.ts | Jawny punkt utworzenia learning record po proof; finalny receipt pozostaje immutable |
| apps/api/src/index.ts | Tenant/project authorization; odczyt Mission/run z durable source zamiast samego cache |
| apps/api/src/server.ts oraz api/osa.ts | Ten sam configured store i Brain w obu entrypointach |
| packages/platform/src/index.ts | Stan możliwości wyprowadzony z konfiguracji/evidence, etykieta zakresu osobno |
| dashboard-src/src/views/Control.tsx | Gotowość Memory/store, timestamp probe i evidence; brak statusu READY z samej nazwy adaptera |
| tests/memory-live.test.ts — nowy, opt-in | Realny upstream, zapis → restart/recovery → recall; bez automatycznych kosztownych działań |
| tests/mission-store-durable.test.ts — nowy | Realna baza testowa, restart, concurrent CAS, checksum i duplicate-run refusal |
| tests/memory-security.test.ts — nowy | Cross-tenant denial przed DB/network, write grants, redaction, idempotency, injection |

Ścieżki nowych plików są propozycją planu; nie oznaczają istniejącej implementacji.

## Konfiguracja i brakujące wejścia

Istniejące zmienne adaptera:
`OSA_NEUROSA_BASE_URL`, `OSA_NEUROSA_TOKEN`, `OSA_NEUROSA_BRAIN_ID`,
`OSA_NEUROSA_ORGANIZATION_ID`, `OSA_NEUROSA_PROJECT_ID`.

Do rzeczywistego uruchomienia wymagane są:
- kanoniczna instancja NeurOSA, jej commit i potwierdzony persistent backend;
- dedicated brain oraz docelowa organizacja/projekt;
- osobno ograniczone credentials read/write, przekazane kanałem sekretów;
- wybrana istniejąca baza Mission, credential i sprawdzona migracja;
- production identity/membership boundary;
- jawnie zatwierdzony, niesekretny dokument testowy dla write/recall.

Nie ma dowodu obecności tych wejść w bieżącym deploymentcie. Nie należy prosić o wklejanie tokenów do czatu ani zapisanie ich w repo.

## Testy, proof i kryteria wyjścia

- Istniejąca regresja przechodzi bez zmiany S1/S2 verification.
- Dwie instancje API konkurujące o ten sam revision: tylko jedna wygrywa CAS przed side effect.
- Po restarcie Mission A ma ten sam record/receipt SHA; /missions/:id/run oraz potrzebne /runs/:id działają bez starego cache.
- Realny write → ack zgodny z kontraktem → drugi write z tym samym idempotencyKey nie tworzy drugiej obserwacji; timeout nie prowadzi do nieweryfikowalnego sukcesu.
- Mission B ma context/reference do obserwacji Mission A i niepusty, zweryfikowany memory_context_sha256.
- Inny tenant/project nie może odczytać ani zapisać Memory; odmowa przed wywołaniem upstream.
- Błędny ledger/brainId, niedostępna Memory, missing configuration i przekroczony context budget blokują odpowiedni krok.
- Prompt injection z Memory nie nadaje uprawnień ani nie zmienia przypiętych wymagań Mission.
- Tokeny, sekrety i pełny niekontrolowany context nie trafiają do statusu/logów.
- Proof jest paczką: commit/build → DB restart/CAS evidence → upstream write/recall evidence → PlanningReceipt → Execution/VerificationReceipt → MissionReceipt → osobny MemoryWriteReceipt.
- Fixture może testować mechanikę, ale nie jest dowodem realnego agent execution lub pełnego A→Z.
- Nie deklarujemy adaptacyjnego uczenia, model quality ani zewnętrznej autentyczności ledgeru na podstawie samego digestu.

## Rollback

Zatrzymać nowe writes i dispatcher, zachować snapshots/outbox/receipts. Nie usuwać danych i nie odtwarzać automatycznie nierozliczonych side effects. Cofnąć aplikację do poprzedniej zgodnej wersji z wyłączoną capability Memory; obowiązkowy profil Memory ma fail closed zamiast przejścia do PROCESS_MEMORY. Migracja musi być addytywna i zgodna z uzgodnionym rollbackiem.

## Status

NEXT_STEP_PREPARED. Memory live nadal UNCONFIGURED w OSA. Implementacja i aktywacja wymagają powyższych wejść oraz testów; nie podbijamy numeru platformy dla samego planu.
