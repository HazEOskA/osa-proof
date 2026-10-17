# OSA Proof v0.1.0 — bramki wydania

**BLOCKED — brak formalnego tagu i GitHub Release.** Bieżący kod, CI i produkcja są w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). Poprzednie odczyty commitów w archiwalnych raportach nie określają aktualnego aliasu.

Cel pozostaje jeden: istniejący produkt w `HazEOskA/osa-proof`, polski interfejs i udowodniona ścieżka agent → wykonanie → dowód. Baza audytu: `main@512a6e17048db549f8b515396b2d7710b40af781`; jedna gałąź `release/osa-proof-v0.1.0` i jeden PR wydawniczy.

## Bieżąca decyzja operatora

Operator zlecił produkcyjne wdrożenie tej gałęzi, usunięcie obowiązkowej sesji NVIDIA w open i przywrócenie Jeffa/Hermesa/OpenRoutera oraz formularza API. Nie oznacza to merge, tagu ani zaliczenia modelowego E2E. Tryb session pozostał w kodzie, a bezpieczne ograniczenia mutujących narzędzi nie zostały usunięte.

W open panel i model są publiczne. Wspólny obszar nie ma wieloużytkownikowego IAM. Własne połączenia API są oddzielone przez losowe ciasteczka HttpOnly i przechowywane zaszyfrowane; nie są częścią wspólnej konfiguracji. Bez Redis limit jest lokalny, nie między instancjami. Nie przedstawiamy tego jako prywatnej wieloużytkownikowej produkcji.

## Aktualne bramki

| Bramka | Wynik i dowód |
|---|---|
| npm test, backend, Worker Host, dashboard | Lokalnie 254 testy: 250 PASS, 0 FAIL, 4 SKIP; buildy poprawne. Kod 3f6ada3 ma 3/3 CI SUCCESS; końcowy checkpoint i jego CI są w PR #16 |
| Interfejs 320/390/1440 | PASS: Czat, Zapytaj OSĘ, profile, wybór dostawcy, formularz API, bez przepełnienia poziomego |
| Native Runtime → Evidence → receipt → niezależna weryfikacja → Replay | PASS lokalnie na trzech rozmiarach, odświeżenie i odmowa zmienionego dowodu. To nie jest modelowy tool_call |
| Worker Host / Docker | Udowodnione rzeczywiste kontenery CI, bez wdrożonego hosta na Vercel |
| Prawdziwy modelowy ONE FLOW | **PASS** na Preview: exec_2b067264-0faf-4d82-b8a6-89b5e84978ff, prawdziwy NVIDIA tool_call → SHA-256 → Runtime → Events/Evidence/receipt → oba verifiery → Postgres → Replay i odświeżenie w pustych kontekstach 320/390/1440; nieautoryzowany dispatch 403 |
| OpenRouter / OpenAI / Anthropic | Transport zaimplementowany; formularz i lokalny kontrakt HTTP sprawdzone; brak prawdziwego wywołania tych dostawców |
| Trwałość serverless | **PASS w zadeklarowanym zakresie rdzenia**: rzeczywisty Postgres dla Unified/Evidence/receipts/Mission Kernel/zaszyfrowanych połączeń; nowy proces, nowa instancja API i CAS PASS. Kolejki, workery, szkic Buildera i część konfiguracji nadal PROCESS_MEMORY |
| Sekrety | Lokalny test szyfrowania, izolacji właściciela, integralności i braku klucza w API/UI storage; skaner diffu. Brak nowych sekretów w repo |
| Dokumentacja/statusy | Jedna [MACIERZ.md](MACIERZ.md), aktualny [OPERATOR.md](OPERATOR.md) i [POLACZENIA_API.md](POLACZENIA_API.md) |

Weryfikacja odpowiedzi NVIDIA dotyczy zapisanych danych i skrótów, nie podpisu wystawionego przez dostawcę. Receipt Unified v2 nie obejmuje pełnych payloadów każdego zdarzenia Replay. Mission Kernel ma osobną zapieczętowaną oś zdarzeń.

## Minimalny pozostały zakres

Modelowy ONE FLOW i trwały zapis rdzenia mają już rzeczywiste dowody. Pierwszy pozostały brak dla zleconych trzech kroków to połączenie Vercel z istniejącym Worker Hostem: rzeczywiste `OSA_WORKER_BASE_URL` i serwerowy `OSA_WORKER_TOKEN`. Nie ma tych zmiennych ani dostępnych poświadczeń Azure. Kod deployu tworzy płatne zasoby i nie może zastąpić brakującego hosta przy budżecie 0. Po otrzymaniu istniejącego połączenia należy sprawdzić health, rzeczywisty sandbox, receipt i cleanup bez commit/push do repo użytkownika. Nie odblokowujemy Buildera samą flagą. NeurOSA i roadmap pozostają ograniczone zgodnie z macierzą.

## Stan zastany i PR-y

- Historyczny stan bazowy produkcji Vercel: `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`, commit `512a6e1`, READY, open/PROCESS_MEMORY. Nie jest to aktualny alias. Najnowszy zweryfikowany stan produkcji i SHA są w PR #16; modelowy odbiór nowego kodu opisuje WERYFIKACJA.md.
- PR #13 został scalony 16.10.2026 o 20:51:34 UTC jako `512a6e1`. Issue #14 jest aktualizowane względem rzeczywistych dowodów: model i trwały rdzeń potwierdzone, worker cloud i NeurOSA nadal ograniczone.
- PR #15, head `824ffb2975d32e8f39cefb14def7e5b957a9aa36`: zakres przewodnika został włączony do gałęzi wydawniczej. Zachowano osobny Czat floty agentów. Dawne testy transportu przewodnika symulowały odpowiedź dostawcy; nie są dowodem działania NVIDIA.
- PR #12, head `1b0c6ef1eb1b27068451cede0426361543e7bc61`: starszy, konfliktowy. Bieżący kod zawiera zabezpieczenia tokenu Fleet i SSE; porównanie obecnych plików adaptera wykazuje dodatkową obsługę celu Buildera na main. Scalenie starego UI przywróciłoby iframe i usunęło późniejszy natywny przepływ. Nie scalać.
- PR #2, head `103478f266bdde5b2496d94ca448edb6ebd8405f`: starszy snapshot odzysku. Obecny kod ma `/auth/*`, sesje, kontrakty tożsamości, klienta API i `npm start`; stary snapshot usuwa późniejsze kontrakty dowodów v2, Mission Kernel i integracje. Nie scalać.

CI wydania nie pobiera drugiego repozytorium Fleet; sprawdza lokalne kontrakty HTTP/SSE w kanonicznym repo. To nie jest live test zewnętrznej usługi Fleet.

PR-y źródłowe pozostają bez zmian. Zamknięcie ich jako zastąpionych należy wykonać dopiero po zaakceptowaniu zakresu PR wydawniczego.

## Rollback i zamknięcie

Rollback magazynu: `dpl_72Zv7pX7D5dBUc19J4umiSKNzx7G` / `ef8eed4d3975e1a04801900c4f9d396d8ab60d51`, z zachowaniem bazy i nowych kluczy serwerowych. Dokładna procedura: OPERATOR.md. Dopiero po spełnieniu bramek i zatwierdzonym scaleniu można utworzyć tag v0.1.0, GitHub Release i końcowy checkpoint. Aktualne wdrożenie służy odbiorowi zleconych poprawek.
