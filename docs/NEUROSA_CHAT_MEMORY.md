# Pamięć istniejącego czatu OSA Proof

## Zakres implementacji

Istniejący `JeversonChat` korzysta nadal z `/nvidia/fleet-chat`. Gdy skonfigurowano NeurOSA, backend sprawdza tożsamość i zakres, wykonuje recall przed modelem, przekazuje ograniczony kontekst jako niezaufane dane i zapisuje dowód odpowiedzi przez `brain/observe`. Nie powstaje drugi czat ani lokalna kopia magazynu pamięci.

Pole „Zapamiętaj moją wiadomość” wysyła `remember: true` oraz `conversation_id`. Backend zapisuje tę informację przez `brain/remember` jako `AUTHENTICATED_USER_STATEMENT`: potwierdza autora i przyjęcie wypowiedzi, nie jej semantyczną prawdziwość. Tekst odpowiedzi modelu pozostaje oznaczony jako odpowiedź modelu. Wykonanie narzędzia przez `/unified/execute`, z poprawnym verifierem i werdyktem VERIFIED, zapisuje oddzielne zdarzenie `VERIFIED_RUNTIME` z hashem istniejącego ProofReceipt; nie modyfikuje zapieczętowanego dowodu wykonania.

Zakres wykonania narzędzia pochodzi z autoryzowanego powiązania pamięci, również gdy skonfigurowany projekt nazywa się inaczej niż `osa-proof`. Backend sprawdza zakres przed uruchomieniem narzędzia; deklaracja scope w żądaniu przeglądarki nie nadaje uprawnień.

Adapter stosuje istniejący kontrakt NeurOSA: status, recall, remember/observe oraz odczyt dokumentu. Po zapisie weryfikuje odpowiedź, rewizję, SHA-256 treści i odczytuje dokument ponownie. Klucz idempotencji wynika z hasha zapieczętowanego zdarzenia. Ponowienie tej samej informacji przez tego samego autora w tej samej rozmowie nie tworzy kolejnego dokumentu, również po utracie odpowiedzi na przyjęty zapis.

## Konfiguracja i blokada dostępu

Wymagane są wszystkie pięć dotychczasowych zmiennych backendu:

- `OSA_NEUROSA_BASE_URL`: zweryfikowany origin HTTPS kanonicznej VM; nie starszej Container App.
- `OSA_NEUROSA_TOKEN`: sekret backendu; uprawnienia `brain:read`, `memory:read`, `memory:write` w dedykowanym brain.
- `OSA_NEUROSA_BRAIN_ID`: dla tej integracji `OsaBrain`.
- `OSA_NEUROSA_ORGANIZATION_ID` oraz `OSA_NEUROSA_PROJECT_ID`: zakres potwierdzony przez operatora.

Użytkownik potwierdził istnienie pięciu zmiennych na Vercel. Brak tych zmiennych w kontenerze developerskim nie dowodzi ich braku na Vercel. Z tej sesji nie potwierdzono jeszcze ich nazw, zakresów środowisko/gałąź ani połączenia z VM, ponieważ proxy zatrzymuje odczyty Vercel. Starsza dokumentacja Jeverson wymienia inny zestaw `NEUROSA_*`; nie jest on automatycznie zamieniany na zakres rodzimego backendu OSA.

Klucz modelu pozostaje na serwerze. Po aktywacji pamięci klient nie może podmieniać klucza ani modelu per request. Nie przekazywać żadnego z sekretów do Vite ani do localStorage.

**Dostawcą tożsamości jest GitHub.** Backend implementuje OAuth Authorization Code z PKCE S256, losowym `state` i zaszyfrowanym cookie przepływu (10 minut). Token GitHub służy wyłącznie backendowi do pobrania `/user`; nie trafia do odpowiedzi API, sesji ani przeglądarki. Żądany scope to `read:user`. Zmiana nazwy konta nie zmienia uprawnień: o członkostwie decyduje numeryczny identyfikator zwrócony przez GitHub i jawna lista serwerowa. To przypisanie dostępu do OSA Proof, nie automatyczne sprawdzenie roli w repozytorium GitHub.

Konfiguracja serwera (Node i funkcja Vercel):

| Zmienna | Wymagana wartość |
| --- | --- |
| `OSA_PUBLIC_ORIGIN` | Stały origin HTTPS zatwierdzonego wdrożenia, bez ścieżki. Nie jest wyliczany z nagłówka Host. |
| `OSA_GITHUB_CLIENT_ID` | Client ID aplikacji GitHub OAuth należącej do operatora. |
| `OSA_GITHUB_CLIENT_SECRET` | Sekret tej aplikacji, wyłącznie w bezpiecznych ustawieniach backendu. |
| `OSA_SESSION_KEY` | 32 kryptograficznie losowe bajty jako 64 znaki hex; stały klucz na wszystkich instancjach danego wdrożenia. |
| `OSA_GITHUB_ALLOWED_USER_IDS` | Numeryczne identyfikatory uprawnionych kont GitHub, oddzielone przecinkami. Nie nazwy kont. |
| `OSA_NEUROSA_ORGANIZATION_ID`, `OSA_NEUROSA_PROJECT_ID` | Potwierdzony zakres, przypisywany przez serwer każdemu dozwolonemu kontu. |

W ustawieniach aplikacji GitHub OAuth ustawić callback dokładnie na `${OSA_PUBLIC_ORIGIN}/api/auth/github/callback`. Login rozpoczyna `GET /api/auth/github/login`; status UI pobiera `/api/auth/github/status`. Dla Preview użyć stabilnego, zatwierdzonego originu i odpowiedniej aplikacji OAuth. Nie zgadywać adresu z losowego URL deploymentu. Nie podawać sekretów w czacie ani repozytorium. Niekompletna konfiguracja zatrzymuje inicjalizację; całkowity brak konfiguracji wyłącza logowanie i pokazuje to w UI.

Cookie `__Host-osa_session` jest szyfrowane AES-256-GCM, `Secure`, `HttpOnly`, `SameSite=Lax`, bez Domain, ważne godzinę. Ten sam klucz pozwala odtworzyć sesję po cold start; przy każdym odczycie sprawdzane są czas ważności, bieżąca lista kont oraz zakres. Mutacje z cookie wymagają dokładnie zgodnego Origin, a przy obecności Sec-Fetch-Site również `same-origin`. Endpoint wylogowania usuwa cookies przeglądarki. Nie ma serwerowej listy unieważnionych sesji: skopiowany cookie może działać do końca godziny, usunięcia konta z konfiguracji lub rotacji klucza. Zmiany konfiguracji muszą trafić do wszystkich instancji; rotacja wylogowuje wszystkich.

Włączenie NeurOSA **celowo blokuje** dostęp open/dev do tras danych, w tym planów misji, runów i dowodów. Sama zmiana `OSA_AUTH_MODE=session` nie zastępuje zaufanej tożsamości i członkostwa. `dev-login` nie nadaje dostępu do prywatnej pamięci.

W środowisku chmurowym wyjście OAuth wymaga `github.com` i `api.github.com`. Proxy może przekazywać sekret klienta wyłącznie do `github.com`; `OSA_SESSION_KEY` jest używany lokalnie do kryptografii i wymaga rzeczywistej wartości w procesie, nie placeholdera sekretu sieciowego. Konfiguracja środowiska developerskiego nie konfiguruje automatycznie Vercel. Sam dostęp Git HTTPS do repozytorium nie dostarcza aplikacji OAuth ani sesji użytkownika.

Upstream recall jest globalny w danym brain. Dedykowanie `OsaBrain` jednemu zatwierdzonemu zakresowi jest warunkiem wdrożenia; `projectId` w zapisanym dokumencie nie zapewnia izolacji upstream.

## Dowody i zachowanie w razie błędu

`CHAT_PROVENANCE` zawiera snapshot kontekstu: zakres, Brain ID, ledger head, references i `context_sha256`, hash promptu, odpowiedź modelu, hash jego żądania oraz hash odpowiedzi. Powiązany `MemoryWriteReceipt` określa identyfikator i rewizję dokumentu oraz hash zdarzenia i treści. Receipt można odtworzyć z dokumentu w NeurOSA; nie zależy od pamięci procesu OSA.

`GET /memory/receipts/:document_id` odczytuje dokument z NeurOSA, ponownie sprawdza ledger i integralność, kontroluje zakres i rekonstruuje receipt. Przycisk „Sprawdź źródła i dowód w NeurOSA” dodatkowo przelicza hashe w przeglądarce oraz porównuje zapisaną odpowiedź z wyświetlaną. Gdy GitHub jest skonfigurowany, czat usuwa dawny cache i nie zapisuje rozmów w localStorage. Rozmowa widoczna w UI znika po odświeżeniu lub wylogowaniu; nowa rozmowa korzysta z recall w NeurOSA, bez starej historii. Tryb developerski bez GitHub zachowuje dotychczasowy cache interfejsu.

Hash dowodu nie jest podpisem niezależnej strony ani dowodem semantycznej poprawności modelu. `ledgerValid` pochodzi z uwierzytelnionego API NeurOSA. Zachowanie SQLite po restarcie VM/kontenera wymaga osobnego testu LIVE.

Nieprawidłowy ledger lub zakres zatrzymuje przepływ przed modelem. Niepotwierdzony zapis dowodu odpowiedzi kończy się błędem zamiast pozorowanego sukcesu. Jeśli po zapisie wiadomości model zawiedzie, API zwraca przy błędzie potwierdzenie tego zapisu. Jeśli zapis po wykonaniu narzędzia zawiedzie, API zwraca `MEMORY_WRITE_UNCONFIRMED` z identyfikatorami wykonania; narzędzia nie wolno ponawiać automatycznie. Nie dodano trwałego outboxa ani automatycznego ponawiania takich wykonanych operacji.

Potwierdzenie zapisu wiadomości jest zachowane także przy późniejszym błędzie recall lub zapisu dowodu odpowiedzi. UI pokazuje je przy wiadomości użytkownika i pozwala ponownie odczytać oraz zweryfikować zapis. Nieudany odczyt statusu modelu (np. 401 przed logowaniem) oznacza nieznany stan, a nie diagnozę brakującego sekretu.

## Stan UI

`GET /memory/status` rozróżnia brak konfiguracji, brak uprawnionego dostępu, dostępność i błąd sondy. Pokazuje czas sprawdzenia; nigdy nie deklaruje trwałości po restarcie na podstawie samego HTTP 200. Widok Pamięć i czat korzystają z tego endpointu. Etykieta „wkrótce” w nawigacji pozostaje do czasu rzeczywistego testu integracji LIVE, zgodnie z warunkiem zadania.

## Weryfikacja lokalna

```bash
cd /workspace/osa-proof
npm test
cd dashboard-src
npm run build
cd ..
OSA_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:unified:browser
```

Ostatnia zmienna jest opcjonalna: wskazuje systemowy Chromium, gdy brakuje przeglądarki pobranej przez Playwright. Test przeglądarkowy wymaga dostępnego modułu Playwright; nie jest zależnością produkcyjną.

`tests/memory-chat.test.ts` sprawdza granice zaufania, odmowę open/dev/cross-scope, utratę odpowiedzi i idempotencję, odczyt kontrolny, integralność, rzeczywiste składanie żądania modelu oraz nową rozmowę po restarcie API. Upstream i model w tym teście są jawnie transportami testowymi, **nie integracją LIVE**. Test przeglądarkowy używa lokalnego Runtime i sprawdza m.in. wyłączony zapis pamięci bez konfiguracji.

`tests/github-auth.test.ts` testuje rzeczywisty HTTP lokalnego API z jawnymi atrapami transportu GitHub: PKCE, state/cookies, odmowę kontu spoza listy, odtwarzanie sesji po restarcie, cofnięcie członkostwa, wygaśnięcie/zmianę klucza, CSRF i redakcję błędów upstream. Test UI osobno sprawdza przycisk logowania, wylogowanie i brak prywatnej historii w localStorage, z jawnie zastąpionym statusem logowania. Żaden z tych testów nie potwierdza rzeczywistego OAuth GitHub.

Wynik testów 17 października 2026: 245 testów, 242 PASS, 3 SKIP, 0 FAIL; build API i dashboardu oraz osobne sprawdzenie typów entrypointu Vercel PASS. Przeglądarka mobilna 390×844, desktop 1440×900 i scenariusz UI GitHub PASS, w tym weryfikacja potwierdzonego zapisu przy błędzie recall. Dodatkowe testy sprawdzają niestandardowy projekt i odmowę przed wykonaniem narzędzia. Logi: `/workspace/osa-onboarding/final-integration-tests.log` i `final-integration-browser.log`; raport przeglądarki: `artifacts/osa-native-chat-e2e/results.json`. Pominięto opt-in Fleet HTTP, Docker multi-sandbox i model LIVE. Są to wyniki lokalne, nie test Azure/Vercel ani trwałości SQLite.

## Bramka LIVE pozostaje otwarta

Potrzebne są: konfiguracja aplikacji GitHub OAuth i dozwolonych kont, stały origin oraz klucz sesji, potwierdzony HTTPS do VM, bezpieczne poświadczenia, zweryfikowany docelowy scope, archiwum rozmów, zatwierdzony backup poza VM i konkretny zakres operacji Preview. Należy sprawdzić wersję API działającą na VM względem odczytanego kontraktu repo NeurOSA (`90edd1d58ff1c04a33286165e8e643662e48289e`).

Po zatwierdzeniu operacji zdalnych wymagane są: health/status, zapis i recall, restart zatwierdzonego kontenera, nowa rozmowa bez starej historii, odświeżenie przeglądarki, weryfikacja źródeł/ledgeru/receipt oraz odmowa bez autoryzacji. Import, rzeczywiste liczby dokumentów, konfiguracja Vercel i deployment nie zostały wykonane w ramach implementacji lokalnej.

## Diagnostyka Memory LIVE — Preview (bez płatnego modelu)

Nowy endpoint `POST /memory/diagnostic` dostępny jest **wyłącznie** w trybie `PreviewOperator`, po kontroli Vercel Deployment Protection i same-origin. Pojedyncze jawne uruchomienie z widoku Pamięć zapisuje **jedno syntetyczne zdarzenie** `DIAGNOSTIC_TEST` do istniejącego dedykowanego brain, ponawia identyczny zapis w celu potwierdzenia idempotencji, odczytuje dokument i wykonuje recall z nowej sesji. Wymaga poprawnej referencji do dokładnie tego samego dokumentu i digestów receipt, w przeciwnym razie zwraca błąd (fail closed). Nie wykonuje wywołania modelu, nie ingeruje w Production i nie restartuje infrastruktury.

`status=VERIFIED, assurance=LIVE_MEMORY_IO_INTEGRITY` oznacza **tylko** rzeczywisty cykl HTTP→NeurOSA (pod warunkiem, że deployment wskazuje kanoniczne upstream i chroni Preview). Nie oznacza końcowego E2E 8/8, poprawności odpowiedzi modelu, trwałości po restarcie, poświadczenia niezależnego ani blockchain anchor. Wydrukowane identyfikatory i digests służą jako wejście do późniejszej zewnętrznej kontroli; należy porównać je z aktywnym upstream.

## Single-operator v0.1 — tylko chroniony Preview PR #17

Na gałęzi `codex/neurosa-chat-memory` można włączyć `OSA_PREVIEW_SINGLE_OPERATOR=enabled` jako **Vercel Preview env przypięte wyłącznie do tej gałęzi**. Kod wymaga `VERCEL=1`, `VERCEL_ENV=preview`, dokładnego ref gałęzi, właściciela `HazEOskA` i repo `osa-proof`. Przy innej konfiguracji odmawia uruchomienia. Production nie obsługuje trybu operatora.

Warunkiem bezpieczeństwa jest aktywna Vercel Authentication (Deployment Protection) dla Preview, niezależna od kodu. To tryb **jednego zaufanego obszaru Preview**, a nie identyfikacji konkretnego konta GitHub. Wszyscy użytkownicy mogący otworzyć chroniony Preview, w tym przez share link lub automation bypass, działają jako ten sam operator z tym samym zakresem `OSA_NEUROSA_ORGANIZATION_ID` / `OSA_NEUROSA_PROJECT_ID`. Nie udostępniać linków i bypassów, nie wyłączać protection, nie używać do produkcji ani danych innych operatorów. Mutacje wymagają HTTPS same-origin i kontroli `Sec-Fetch-Site`, a recall/remember nadal wykonuje kontrolę scope, auth i evidence.

Aktywacja nie oznacza potwierdzonego LIVE recall ani trwałości SQLite. Pamięć UI nie zapisuje prywatnej historii w localStorage w trybie operatora.
