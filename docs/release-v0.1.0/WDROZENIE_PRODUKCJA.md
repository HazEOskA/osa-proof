# Produkcyjny odbiór otwartego panelu

> **ODCZYT WERYFIKACYJNY 17.10.2026:** Vercel dla aliasu `osa-proof-three.vercel.app` wskazuje **aktualnie** deployment `dpl_B8s5QZV1t5CMfy6qm453rkFMs2Bh`, target `production`, commit `4c375e8058e30b06f178e261ccb32e4bb45f61b2`, branch `release/osa-proof-v0.1.0`, status `READY`. Wcześniejsze deploymenty `512a6e1` są historycznym punktem cofnięcia, nie bieżącym źródłem tego aliasu. Odczyt metadanych nie dowodzi przejścia aplikacyjnego E2E ani stanu prywatnej sesji. **Brak merge do main, tagu i GitHub Release.** [Audyt uzupełniający](AUDYT_DODATKOWY_2026-10-17.md).

**Granica prywatności:** panel działa w współdzielonym `OPEN_PRODUCTION`; anonimowe żądania mogą korzystać z jednej tożsamości demo `org_dev_local`. Nie używać tu prywatnych eksportów, danych klientów, kluczy ani artefaktów wymagających izolacji. Samo chronienie wywołań NVIDIA nie chroni wszystkich pozostałych tras/mutacji. Jeśli realne dane mają wejść do OSA, wcześniej należy zamknąć dostęp do nich i wykonać osobne testy tenant/scope.


Operator 17.10.2026 osobno zlecił wdrożenie gałęzi `release/osa-proof-v0.1.0` na istniejącą produkcję Vercel, żeby sprawdzić aplikację pod stałym adresem. To zgoda na ten odbiór, bez merge do main, tagu i GitHub Release. Formalne v0.1.0 nadal BLOCKED z powodu brakującego modelowego E2E, współdzielonego limitu i trwałego backendu.

- Repo: `HazEOskA/osa-proof`; projekt `prj_okaBXTo47jIh8MzLfAEouQrHhexK`; zespół `team_inMcYbSrBTyul3ppWT7KixgI`.
- Adres odbioru: https://osa-proof-three.vercel.app. Wdrożenie ma jawny target `production` i wskazany niezmienny commit tej samej gałęzi.
- Panel bez obowiązkowego logowania wymaga `VERCEL=1`, `VERCEL_ENV=production`, `OSA_AUTH_MODE=open`. Stan API: `required=false`, `mode=OPEN_PRODUCTION`. To wspólny obszar `org_dev_local`, bez izolacji między odwiedzającymi. Nie należy przedstawiać go jako wieloużytkownikowego IAM.
- Zmiana kodu obejmuje wyłącznie rozszerzenie istniejącego trybu open na produkcję i testy tej polityki. Tryb session pozostaje chroniony.
- Wywołania NVIDIA nadal wymagają autoryzacji operatora, zgodnego originu, polityki zerowych kosztów i współdzielonego limitu. Klucz pozostaje na serwerze; bez zmiany sekretów i bez wywołania płatnego modelu.
- Nie włączono narzędzi mutujących, Web3, workera ani provisioningu. PROCESS_MEMORY i lokalny eksport bundle zachowują swoje ograniczenia.

Bezpośrednia promocja wcześniejszego Preview `4964a8c` zwróciła 422 i nie przełączyła ruchu. Dlatego wymagany jest nowy build z rzeczywistym targetem production; nie przenosimy sekretów z Preview.

Przed publikacją: pełne npm test, buildy i lokalny browser E2E z produkcyjną polityką open na 320/390/1440. Odbiór live musi potwierdzić HTML oraz `/api/auth/access` i `/api/build/status` bez cookie; same READY lub zielone CI nie wystarczają. Bieżący commit, deployment i wyniki odbioru są zapisane w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16).

Rollback tej operacji: poprzednia produkcja `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`, commit `512a6e17048db549f8b515396b2d7710b40af781`. Przywrócenie odtwarza wcześniejszy otwarty panel; nie usuwa danych ani sekretów. Nie ma migracji bazy do odwracania.
