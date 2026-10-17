# Obsługa kandydata v0.1.0

Produkt: https://osa-proof-three.vercel.app. Jedno repo `HazEOskA/osa-proof`, gałąź `release/osa-proof-v0.1.0`, [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). PR zawiera bieżący SHA, CI i deployment. Formalny tag/release nie został utworzony.

## Czat i połączenia API

1. Otwórz **Czat floty agentów**. Domyślny profil to Jeff; Hermes i pozostałe role są w wyborze agenta.
2. Wybierz dostawcę w polu Model. OpenRouter jest dostępny jako osobna opcja.
3. Otwórz **Połączenia API** w czacie albo **Sterowanie → Sekrety** w frameworku. Wybierz dostawcę, wpisz identyfikator modelu i własny klucz, następnie połącz.
4. Klucz jest wysyłany wyłącznie do serwera tego wdrożenia. Nie wraca w metadanych i nie trafia do localStorage, sessionStorage ani historii. Ciasteczko HttpOnly przypisuje połączenie tej przeglądarce. Nie wklejaj klucza w wiadomość czatu.
5. Domyślny NVIDIA Nemotron i `openrouter/free` korzystają z bezpłatnych wariantów. Pozostałe modele wymagają zaznaczenia zgody na rozliczenie własnego konta; brak automatycznego płatnego zamiennika. Wpisz dokładne ID aktualnie dostępne na swoim koncie dostawcy.
6. Skonfigurowane wdrożenie z magazynem Postgres przechowuje prywatne połączenia zaszyfrowane po stronie serwera przez 30 dni. Wymaga tego samego cookie właściciela; usunięcie cookie lub klucza AES uniemożliwia ich odczyt. Wdrożenie bez magazynu jawnie pokazuje PROCESS_MEMORY do godziny i możliwość utraty przy zmianie instancji.
7. Przycisk **Usuń własny klucz** usuwa prywatne połączenie. Jeśli serwer ma osobny klucz środowiskowy, pozostaje dostępny jako domyślne połączenie; formularz go nie ujawnia ani nie usuwa.

OpenAI i Anthropic używają istniejących adapterów. Dodatkowe zgodne API wymagają adresu HTTPS z listy podanej w formularzu. Modelowe narzędzie SHA-256 jest obsługiwane obecnie dla NVIDIA; inni dostawcy obsługują zwykłą rozmowę. Profile rozmowy nie oznaczają autonomicznych workerów.

Globalne **Zapytaj OSĘ** ma wybór dostawcy, kontekst modułu i przejście do połączeń. Przewodnik nie wykonuje narzędzi.

## Dostęp i limity

Na polecenie operatora `OSA_AUTH_MODE=open` w Vercel Preview/production obejmuje panel i NVIDIA bez sesji operatora. `/api/auth/access` raportuje `required=false`. Nie ma obowiązkowego logowania Vercel ani kodu operatora w ścieżce produktu. To wspólny obszar demonstracyjny, bez wieloużytkownikowego IAM; prywatne połączenia mają osobne cookies, a pozostały współdzielony stan nie jest prywatną historią użytkownika.

Tryb `session` pozostaje w kodzie: podpisana sesja, origin, organizacja i projekt, cookie HttpOnly/Secure/SameSite=Strict. Nie włączano go ponownie. Zapis/usuwanie prywatnego połączenia wymaga zgodnego originu także w open.

Bez podłączonego Redis open używa limitu 3/min i 30/h na instancję i klucz. To nie jest limit globalny między instancjami. Adapter atomowego Redis REST pozostaje dostępny przez `OSA_QUOTA_REDIS_REST_URL` i `OSA_QUOTA_REDIS_REST_TOKEN`; nie uruchomiono nowej usługi. Model NVIDIA inny niż dokładny domyślny Nemotron zachowuje wcześniejszą politykę bezpłatności.

## Dane i uruchomienie

```bash
npm ci
npm test
npm run worker:build
node scripts/build-dashboard.cjs
```

- Wykonania Unified, dowody, receipts, Mission Kernel i zaszyfrowane połączenia: rzeczywisty Postgres. Pełny zakres oraz konfiguracja: [DURABILNOSC_2026-10-17.md](DURABILNOSC_2026-10-17.md).
- Kolejki, rejestr workerów, szkic Buildera, polityki i lokalna wiedza: PROCESS_MEMORY, bez gwarancji przetrwania restartu.
- Zwykła historia czatu: localStorage urządzenia. Wykonanie otwarte przez `?execution_id=...` jest pobierane z Postgresa i ponownie weryfikowane, także w pustej przeglądarce. Następnie otwórz Inspektor → Odtwarzanie. Replay nie uruchamia ponownie modelu.
- Lokalny magazyn połączeń: szyfrowane pliki 0600 w ignorowanym `.osa-proof/connections`; test restartu i współbieżnego zapisu przechodzi.
- Podłączony magazyn: `OSA_STORAGE_URL`, `OSA_STORAGE_NAMESPACE`, `OSA_STORAGE_PRIVATE_KEY_B64` oraz 64-znakowy szesnastkowy `OSA_CONNECTIONS_ENCRYPTION_KEY`, wyłącznie serwerowo. Preview i produkcja mają osobne klucze. Nie dodawaj sekretów do `VITE_*`. Brak odpowiedzi bazy odrzuca zapis zamiast deklarować utrwalony sukces.
- Worker Host: rzeczywisty Docker został udowodniony w CI; brak podłączonego hosta na Vercel. Builder zachowuje grant wykonania i izolację.
- Cloud deploy, NeurOSA i Regulated: warunki zgodnie z [MACIERZ.md](MACIERZ.md). Nie importowano prywatnej historii, nie uruchomiono płatnej infrastruktury.

## Odbiór modelu i rollback

Rzeczywisty modelowy test na Preview przeszedł: `exec_2b067264-0faf-4d82-b8a6-89b5e84978ff`. Dowód, oba weryfikatory, odczyt z Postgresa w pustej przeglądarce, Replay i odświeżenie: PASS na 320/390/1440. Łącznie wykonano dwa bezpłatne żądania NVIDIA; brak płatnego fallbacku. Nieautoryzowany dispatch narzędzia zwrócił 403. Test odmowy anonimowego modelu dotyczy trybu session; open na zlecenie operatora dopuszcza model bez sesji.

Rollback nowego magazynu: wcześniejsza gotowa produkcja `dpl_72Zv7pX7D5dBUc19J4umiSKNzx7G`, commit `ef8eed4d3975e1a04801900c4f9d396d8ab60d51`. Zachowuje formularz API, profile i NVIDIA bez logowania, wraca do PROCESS_MEMORY. Nie usuwać bazy ani rekordów przy cofnięciu kodu. Zachować klucze AES/podpisu, aby powrót do nowej wersji odzyskał dane. Bieżący deployment oraz wynik odbioru produkcji: PR #16. Formalny release czeka na brakujące połączenie istniejącego Worker Hosta; nie wymaga to kolejnego modelowego testu.
