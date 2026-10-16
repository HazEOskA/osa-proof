# OSA Proof v0.1.0 — kandydat do wydania

**Stan: BLOCKED. Nie utworzono wydania ani tagu.** Numer `0.1.0` w pakiecie nie oznacza przejścia bramek.

Cel: jeden produkt w `HazEOskA/osa-proof`, istniejący polski interfejs i jedna udowodniona ścieżka agent → wykonanie → dowód. Baza: `main@512a6e17048db549f8b515396b2d7710b40af781`. Gałąź robocza: `release/osa-proof-v0.1.0`.

## Stan zastany i PR-y

- Produkcja Vercel: `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`, commit `512a6e1`, READY. Alias: https://osa-proof-three.vercel.app. Odczyt bez sesji potwierdził HTTP 200 dla `/api/nvidia/status`, `/api/build/status` i `/api/permissions`, `auth_mode=open`, `persistence=PROCESS_MEMORY`, `mission_persistence=PROCESS_MEMORY`, `brain.memory=NONE`. To dowód dostępności tych tras, nie test wywołania modelu.
- PR #13 został scalony 16.10.2026 o 20:51:34 UTC jako `512a6e1`. Issue #14 opisuje starszy stan i wymaga aktualizacji; jego warunki pamięci, workerów oraz prawdziwego wykonania modelowego pozostają niespełnione.
- PR #15, head `824ffb2975d32e8f39cefb14def7e5b957a9aa36`: zakres przewodnika został włączony do gałęzi wydawniczej. Zachowano osobny Czat floty agentów. Dawne testy transportu przewodnika symulowały odpowiedź dostawcy; nie są dowodem działania NVIDIA.
- PR #12, head `1b0c6ef1eb1b27068451cede0426361543e7bc61`: starszy, konfliktowy. Bieżący kod zawiera zabezpieczenia tokenu Fleet i SSE; porównanie obecnych plików adaptera wykazuje dodatkową obsługę celu Buildera na main. Scalenie starego UI przywróciłoby iframe i usunęło późniejszy natywny przepływ. Nie scalać.
- PR #2, head `103478f266bdde5b2496d94ca448edb6ebd8405f`: starszy snapshot odzysku. Obecny kod ma `/auth/*`, sesje, kontrakty tożsamości, klienta API i `npm start`; stary snapshot usuwa późniejsze kontrakty dowodów v2, Mission Kernel i integracje. Nie scalać.

CI wydania nie pobiera drugiego repozytorium Fleet; sprawdza lokalne kontrakty HTTP/SSE w kanonicznym repo. To nie jest live test zewnętrznej usługi Fleet.

PR-y źródłowe pozostają bez zmian. Zamknięcie ich jako zastąpionych należy wykonać dopiero po zaakceptowaniu zakresu PR wydawniczego.

## Naprawy przygotowane w kodzie

1. Wszystkie trasy API w Vercel lub `NODE_ENV=production` wymagają sesji operatora. `open` oraz deweloperskie logowanie nie obchodzą tej ochrony. Brak konfiguracji kończy się 503; anonimowe żądanie przy skonfigurowanym dostępie — 401. Prywatne odpowiedzi mają `Cache-Control: no-store`.
2. Sesja operatora jest podpisana, ograniczona do jednego originu, organizacji i projektu; działa między instancjami bez `SessionStore`. Cookie: `__Host-osa-operator`, HttpOnly, Secure, SameSite=Strict, 30 minut. Żądania zmieniające stan wymagają zgodnego `Origin`. To dostęp jednego operatora, **nie pełny wieloużytkownikowy IAM/OIDC/RBAC**. Rotacja klucza unieważnia wszystkie sesje; wylogowanie usuwa cookie, nie cofa kopii wcześniej skradzionego cookie przed jego wygaśnięciem.
3. Klucze NVIDIA są konfigurowane wyłącznie na serwerze. HTTP odrzuca `apiKey` i zmianę modelu poza konfigurację. Formularz klucza dostawcy usunięto z przeglądarki.
4. W chmurze obowiązuje `OSA_ZERO_COST_ONLY=true`, jawne potwierdzenie bezpłatnego dostępu do konkretnego modelu z ważnością maksymalnie 24 godziny i współdzielony licznik. Brak któregokolwiek warunku blokuje żądanie; brak automatycznego płatnego zamiennika i retry.
5. Adapter limitu Redis REST używa jednego atomowego EVAL, czasu Redis i okien 3/min oraz 30/h na organizację i projekt. Nie uruchomiono usługi ani bazy. Zachowanie na prawdziwym Redis nie zostało potwierdzone; test transportu jest symulowany. Awaria licznika blokuje model. Lokalny limit procesu nie jest używany jako zamiennik w chmurze.
6. Opcja „Narzędzia modelu” wysyła definicję `osa_sha256` do NVIDIA. Wyłącznie walidowane `tool_calls` z odpowiedzi dostawcy uruchamiają istniejący Runtime. Narzędzie jest tylko odczytowe. Dowód zawiera ID odpowiedzi, żądany i raportowany model oraz skróty żądania i odpowiedzi. Klient nie może dostarczyć własnego modelowego dispatchu. Deterministyczne polecenia natywne pozostają jawnie oddzielne.
7. Nowy zapis lokalnego bundle jest weryfikowany po odświeżeniu przez przeglądarkę oraz stateless API. To lokalny eksport, nie trwałe przechowywanie w chmurze. Brak poprawnej weryfikacji nie tworzy stanu LIVE.

Zmiany te nie zabezpieczają jeszcze działającej produkcji: do produkcji nie wdrożono gałęzi wydawniczej.

## Niespełnione warunki obowiązkowe

Pierwszy warunek dla nowego Preview: skonfigurowany dostęp operatora na gałęzi wydawniczej. Następnie: potwierdzona bezpłatność konta/modelu NVIDIA i działający, współdzielony limit żądań. Samo `configured=true` dla klucza nie spełnia tych warunków.

Po ich spełnieniu trzeba wykonać rzeczywisty test NVIDIA → modelowe `tool_calls` → Runtime → Evidence → ProofReceipt → niezależna weryfikacja → Replay na Preview w 320/390/1440 px i test odmowy dostępu. Nie ma zweryfikowanego cloud `execution_id` z tej sesji. Symulowanego dostawcy nie wolno zaliczyć do tej bramki.

Oddzielny bloker: brak trwałego backendu dla historii wykonań, sesji rozmów, misji i kolejek w serverless. Nie można potwierdzić odtworzenia z innego urządzenia lub po utracie instancji. Wybór i skonfigurowanie istniejącego trwałego backendu wymaga decyzji operatora. Nie utworzono płatnej bazy. Lokalny FileMissionStore i przeglądarkowy zapis bundle nie rozwiązują tego problemu.

Pełna ścieżka modelowa ma zapis skrótu odpowiedzi dostawcy, a nie kryptograficzne poświadczenie wydane przez NVIDIA. Receipt v2 wiąże dowody i wynik; nie zawiera pełnego kryptograficznego zobowiązania do każdego payloadu zdarzenia Replay. Struktura i execution_id zdarzeń są sprawdzane. Mission Kernel ma osobną weryfikację zapieczętowanej osi misji — nie należy utożsamiać jej z bezpośrednim wykonaniem Unified.

## Decyzja

Brak zgody na merge, tag i GitHub Release przed zamknięciem obowiązkowych bramek. Produkcyjny deploy oraz zmiana ochrony produkcji wymagają osobnego zatwierdzenia dokładnego commitu i konfiguracji. Macierz możliwości: [MACIERZ.md](MACIERZ.md). Instrukcja operatora: [OPERATOR.md](OPERATOR.md).

Historia rozmów, szkic Buildera i lokalny bundle w chronionym środowisku mają osobne klucze storage dla organizacji/projektu potwierdzonych przez sesję. Stare zapisy bez zakresu pozostają na urządzeniu; nie są kasowane ani automatycznie importowane do chronionego projektu. To rozdzielenie widoków lokalnych, nie szyfrowany magazyn ani granica bezpieczeństwa między osobami korzystającymi z tego samego profilu przeglądarki.
