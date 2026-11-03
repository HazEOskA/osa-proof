# OSA Proof — luka Team Graph, historia misji, chronologia czatów

**Data:** 03.11.2026 · **Scope:** READ_ONLY diagnosis + proposal · **Target:** `HazEOskA/osa-proof` @ `main` `9aa81ab667a12b6ab38ff4d6bd61a1d7c52a41e6`.

## GAP-TG-01: Team Graph — lokalny szkic ≠ trwały zapis

**Źródło:** `dashboard-src/src/build.tsx` inicjuje `osa.build.workspace.v1` z `localStorage`, zapisuje szkic przy `update()`, a `save()` wysyła `POST /build/workspace`. `apps/api/src/index.ts` zapisuje `state.buildWorkspace` i rejestruje graf w `state.teams`, które działają w pamięci procesu. `GET /build/workspace` po restarcie lub na innej instancji może nie znaleźć zapisu.

**Wymaganie docelowe:** niezmienne `team_graph_versions`, niezależne wersje szkiców i opublikowanych definicji, `owner/tenant/project` scope, readback po restarcie, walidacja grafu oraz jawny `save status`. Misja ma odwoływać się do konkretnej, przypiętej wersji. Bez cichego nadpisywania przez starszą kartę.

## GAP-MIS-01/GAP-MIS-02: brak indeksu historii i UI ją nadpisuje

**Źródło:** Studio (`dashboard-src/src/views/BuildWorkspace.tsx`) tworzy `/teams` → `/missions` → `/missions/:id/run`, a eksport `/missions/:id` wymaga znanego `mission_id`. `dashboard-src/src/data/data.ts` w `inspectExecution()` wykonuje `setData(... missions:[mission], runs:[run])`: to świadomie zastępuje listy w widoku, więc starsze wykonania znikają ze snapshotu UI. `MissionStore` ma tylko `get(id)` oraz `save(record, revision)`, bez `list`/cursor.

**Wymaganie docelowe:** `GET /missions?cursor=...` z filtrowaniem po tenant/user/project, indeks `created_at DESC, mission_id DESC` (daty muszą pochodzić z serwera lub zweryfikowanego rekordu), paginacja, `Run/Proof/Replay` przy każdym rekordzie; odczyt bez re-execution. `inspectExecution` zachowuje już znane rekordy, nie zastępuje całego globalnego stanu.

**Regresja:** dwie misje na tym samym koncie, refresh, przełączenie ekranu, restart, druga autoryzowana przeglądarka, brak dostępu innego tenanta, brak duplikatu po retry. Nie deklarować historii ze statycznego `snapshot.json` jako live SOT.

## GAP-CHAT-01/GAP-CHAT-02: niesortowane rozmowy i ryzyko utraty

**Źródło:** `dashboard-src/src/lib/chat-history.ts` przechowuje `sessions` w IndexedDB `osa.native-chat.history.v2` kluczowane `id`. `getAll()` nie sortuje według daty, `JeversonChat.tsx` renderuje sesje w kolejności tablicy, bez `.sort(updated)`; zapis robi `clear()` i pełną rekonstrukcję. Komponent ogranicza zachowywane sesje do `slice(0,50)`, a wiadomości do `slice(-100)`.

**Minimalna poprawka UI:** stabilne sortowanie według `updated` malejąco, remisy po `id`, z walidacją timestampów i testem po odświeżeniu. Wyłącznie sortowanie nie naprawi cross-device ani problemu dwóch kart.

**Docelowy zapis:** `chat_sessions`/`chat_messages` po autoryzowanym owner scope, uporządkowanie stabilne, idempotentny append, kontrola wersji przy równoległych edycjach, paginacja bez ucinania historii i kopia lokalna dla offline. Migracja z IndexedDB wyłącznie po backupie, porównaniu i wyraźnej zgodzie. **Nie czyścić ani nie migrować automatycznie obecnej bazy.**

## GAP-AUTH-01: obserwowany `OAUTH_STATE_INVALID`

Screenshot operatora wskazuje odpowiedź JSON `{"code":"OAUTH_STATE_INVALID"}`. Bez logów callback, dokładnego URL, konfiguracji sesji i odpowiedzi Set-Cookie nie można podać pewnej przyczyny. Naprawę OAuth prowadzić jako oddzielny scope i test ochrony sesji; nie obchodzić OAuth przez wyłączenie auth.

## Kryteria odbioru

| Test | PASS |
| --- | --- |
| Reload tego samego urządzenia | Team Graph, sesje i lista misji odtworzone bez ręcznej kopii |
| Restart dwóch instancji API | Kanoniczny zapis nienaruszony; stan nie zależy od pamięci procesu |
| Cross-device | Ta sama autoryzowana tożsamość widzi swoje dane, inna nie |
| Chronologia czatów | Nowa aktywność podnosi rozmowę na górę, stabilny porządek po reload |
| Dwie karty / równoległy zapis | Brak utraconych sesji i brak cofnięcia rewizji |
| Mission Proof | Starszy Run, Evidence, Receipt i Replay dostępne bez ponownego execute |
| Tamper/CAS | Zły digest lub konflikt revision → fail-closed, nie „udało się” |
| Backup/restore | Pełny readback danych, liczniki i hashe zgodne |

## Przed każdą mutacją

**Gate G0: prywatny backup IndexedDB `osa.native-chat.history.v2` i lokalnych kluczy `osa.native-chat.v1`, `osa.native-chat.active.v1`, `osa.build.workspace.v1`.** Dane mogą zawierać osobiste treści, więc nie wklejać eksportu do publicznych issue/PR. Następnie G1: kontrakty; G2: lokalne testy; G3: host i trwały storage; G4: Preview; G5: osobna akceptacja Production.

**Status:** root causes potwierdzone na poziomie kodu; implementacja i migracja NIE wykonane.
