# OSA Proof v0.1.0 — bramki wydania

**BLOCKED — brak formalnego tagu i GitHub Release.** Bieżący kod, CI i produkcja są w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). Poprzednie odczyty commitów w archiwalnych raportach nie określają aktualnego aliasu.

Cel pozostaje jeden: istniejący produkt w `HazEOskA/osa-proof`, polski interfejs i udowodniona ścieżka agent → wykonanie → dowód. Baza audytu: `main@512a6e17048db549f8b515396b2d7710b40af781`; jedna gałąź `release/osa-proof-v0.1.0` i jeden PR wydawniczy.

## Bieżąca decyzja operatora

Operator zlecił produkcyjne wdrożenie tej gałęzi, usunięcie obowiązkowej sesji NVIDIA w open i przywrócenie Jeffa/Hermesa/OpenRoutera oraz formularza API. Nie oznacza to merge, tagu ani zaliczenia modelowego E2E. Tryb session pozostał w kodzie, a bezpieczne ograniczenia mutujących narzędzi nie zostały usunięte.

W open panel i model są publiczne. Wspólny obszar nie ma wieloużytkownikowego IAM. Własne połączenia API są oddzielone przez losowe ciasteczka HttpOnly i przechowywane zaszyfrowane; nie są częścią wspólnej konfiguracji. Bez Redis limit jest lokalny, nie między instancjami. Nie przedstawiamy tego jako prywatnej wieloużytkownikowej produkcji.

## Aktualne bramki

| Bramka | Wynik i dowód |
|---|---|
| npm test, backend, Worker Host, dashboard | Lokalnie 251 testów: 247 PASS, 0 FAIL, 4 SKIP; buildy poprawne. CI bieżącego SHA musi być zielone |
| Interfejs 320/390/1440 | PASS: Czat, Zapytaj OSĘ, profile, wybór dostawcy, formularz API, bez przepełnienia poziomego |
| Native Runtime → Evidence → receipt → niezależna weryfikacja → Replay | PASS lokalnie na trzech rozmiarach, odświeżenie i odmowa zmienionego dowodu. To nie jest modelowy tool_call |
| Worker Host / Docker | Udowodnione rzeczywiste kontenery CI, bez wdrożonego hosta na Vercel |
| Prawdziwy modelowy ONE FLOW | **BLOCKED**: brak potwierdzonego wykonania; automatyczna kontrola odrzuciła próbę NVIDIA w produkcji z braku osobnej zgody na koszt i zakres |
| OpenRouter / OpenAI / Anthropic | Transport zaimplementowany; formularz i lokalny kontrakt HTTP sprawdzone; brak prawdziwego wywołania tych dostawców |
| Trwałość serverless | **BLOCKED**: ApiState/historia misji/kolejki i prywatne połączenia bez trwałego backendu. localStorage i lokalny filesystem tego nie zastępują |
| Sekrety | Lokalny test szyfrowania, izolacji właściciela, integralności i braku klucza w API/UI storage; skaner diffu. Brak nowych sekretów w repo |
| Dokumentacja/statusy | Jedna [MACIERZ.md](MACIERZ.md), aktualny [OPERATOR.md](OPERATOR.md) i [POLACZENIA_API.md](POLACZENIA_API.md) |

Weryfikacja odpowiedzi NVIDIA dotyczy zapisanych danych i skrótów, nie podpisu wystawionego przez dostawcę. Receipt Unified v2 nie obejmuje pełnych payloadów każdego zdarzenia Replay. Mission Kernel ma osobną zapieczętowaną oś zdarzeń.

## Minimalny pozostały zakres

Pierwszy brak to dozwolony, rzeczywisty test bezpłatnego modelu i jego tool_call z pełnym dowodem; nie zastępujemy go płatnym modelem ani obejściem odrzuconego wywołania. Następny brak to podłączenie istniejącego trwałego backendu i potwierdzenie restartu/wielu instancji. Nie utworzono płatnej bazy ani infrastruktury. Cloud deployment i NeurOSA pozostają zgodnie z macierzą ograniczone, dopóki nie ma rzeczywistego hosta/połączenia.

## Stan zastany i PR-y

- Produkcja Vercel: `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`, commit `512a6e1`, READY. Alias: https://osa-proof-three.vercel.app. Odczyt bez sesji potwierdził HTTP 200 dla `/api/nvidia/status`, `/api/build/status` i `/api/permissions`, `auth_mode=open`, `persistence=PROCESS_MEMORY`, `mission_persistence=PROCESS_MEMORY`, `brain.memory=NONE`. To dowód dostępności tych tras, nie test wywołania modelu.
- PR #13 został scalony 16.10.2026 o 20:51:34 UTC jako `512a6e1`. Issue #14 opisuje starszy stan i wymaga aktualizacji; jego warunki pamięci, workerów oraz prawdziwego wykonania modelowego pozostają niespełnione.
- PR #15, head `824ffb2975d32e8f39cefb14def7e5b957a9aa36`: zakres przewodnika został włączony do gałęzi wydawniczej. Zachowano osobny Czat floty agentów. Dawne testy transportu przewodnika symulowały odpowiedź dostawcy; nie są dowodem działania NVIDIA.
- PR #12, head `1b0c6ef1eb1b27068451cede0426361543e7bc61`: starszy, konfliktowy. Bieżący kod zawiera zabezpieczenia tokenu Fleet i SSE; porównanie obecnych plików adaptera wykazuje dodatkową obsługę celu Buildera na main. Scalenie starego UI przywróciłoby iframe i usunęło późniejszy natywny przepływ. Nie scalać.
- PR #2, head `103478f266bdde5b2496d94ca448edb6ebd8405f`: starszy snapshot odzysku. Obecny kod ma `/auth/*`, sesje, kontrakty tożsamości, klienta API i `npm start`; stary snapshot usuwa późniejsze kontrakty dowodów v2, Mission Kernel i integracje. Nie scalać.

CI wydania nie pobiera drugiego repozytorium Fleet; sprawdza lokalne kontrakty HTTP/SSE w kanonicznym repo. To nie jest live test zewnętrznej usługi Fleet.

PR-y źródłowe pozostają bez zmian. Zamknięcie ich jako zastąpionych należy wykonać dopiero po zaakceptowaniu zakresu PR wydawniczego.

## Rollback i zamknięcie

Poprzedni gotowy deployment przed formularzem API: `dpl_AJrtC3jRjUhsD3y42iCmS91Gv6ns` / `7c823f57fcf62f4af3086e20877c9067f89e7ce5`. Brak migracji bazy i zmian istniejących sekretów. Dopiero po spełnieniu bramek i zatwierdzonym scaleniu można utworzyć tag v0.1.0, GitHub Release i końcowy checkpoint. Aktualne wdrożenie służy odbiorowi zleconych poprawek.
