# Obsługa kandydata v0.1.0

Produkt: https://osa-proof-three.vercel.app. Jedno repo `HazEOskA/osa-proof`, gałąź `release/osa-proof-v0.1.0`, [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). PR zawiera bieżący SHA, CI i deployment. Formalny tag/release nie został utworzony.

## Czat i połączenia API

1. Otwórz **Czat floty agentów**. Domyślny profil to Jeff; Hermes i pozostałe role są w wyborze agenta.
2. Wybierz dostawcę w polu Model. OpenRouter jest dostępny jako osobna opcja.
3. Otwórz **Połączenia API** w czacie albo **Sterowanie → Sekrety** w frameworku. Wybierz dostawcę, wpisz identyfikator modelu i własny klucz, następnie połącz.
4. Klucz jest wysyłany wyłącznie do serwera tego wdrożenia. Nie wraca w metadanych i nie trafia do localStorage, sessionStorage ani historii. Ciasteczko HttpOnly przypisuje połączenie tej przeglądarce. Nie wklejaj klucza w wiadomość czatu.
5. Domyślny NVIDIA Nemotron i `openrouter/free` korzystają z bezpłatnych wariantów. Pozostałe modele wymagają zaznaczenia zgody na rozliczenie własnego konta; brak automatycznego płatnego zamiennika. Wpisz dokładne ID aktualnie dostępne na swoim koncie dostawcy.
6. Obecny Vercel przechowuje prywatne połączenia w szyfrowanym PROCESS_MEMORY przez maksymalnie godzinę. Restart lub inna instancja wymaga ponownego dodania klucza. To nie jest trwały magazyn chmurowy. Widoczny komunikat podaje ograniczenie.
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

- ApiState, misje i kolejki na Vercel: PROCESS_MEMORY, bez gwarancji przetrwania restartu.
- Czat i zweryfikowany bundle: localStorage tego urządzenia; po odświeżeniu dowód jest ponownie weryfikowany.
- Lokalny magazyn połączeń: szyfrowane pliki 0600 w ignorowanym `.osa-proof/connections`; test restartu i współbieżnego zapisu przechodzi.
- Opcjonalny Postgres: `OSA_CONNECTIONS_DATABASE_URL` i 64-znakowy szesnastkowy `OSA_CONNECTIONS_ENCRYPTION_KEY`, wyłącznie serwerowo. Adapter nie został połączony/testowany z rzeczywistą chmurą. Nie dodawaj sekretów do `VITE_*`.
- Worker Host: rzeczywisty Docker został udowodniony w CI; brak podłączonego hosta na Vercel. Builder zachowuje grant wykonania i izolację.
- Cloud deploy, NeurOSA i Regulated: warunki zgodnie z [MACIERZ.md](MACIERZ.md). Nie importowano prywatnej historii, nie uruchomiono płatnej infrastruktury.

## Odbiór modelu i rollback

Pełny modelowy test pozostaje niezaliczony. Automatyczna kontrola odrzuciła próbę NVIDIA z `execute_tools=true` w produkcji, wskazując brak osobnej zgody na koszt i zakres. Nie ponawiano jej inną drogą. Testy kontrolowanego transportu nie zastępują rzeczywistego modelu.

Po uzyskaniu odpowiedniego zakresu test musi objąć prawdziwy tool_call NVIDIA do `osa_sha256`, jeden execution_id, oba weryfikatory, Evidence, receipt, Replay, odświeżenie i odmowę obcego narzędzia. Test odmowy anonimowego modelu dotyczy trybu session; open na zlecenie operatora świadomie dopuszcza model bez sesji.

Rollback bieżącej korekty API: poprzednia gotowa produkcja `dpl_AJrtC3jRjUhsD3y42iCmS91Gv6ns`, commit `7c823f57fcf62f4af3086e20877c9067f89e7ce5`. Przywraca NVIDIA bez logowania operatora, przed formularzem API i profilami. Nie wykonano migracji bazy ani rotacji istniejących sekretów. Powrót nie odtwarza tymczasowych połączeń procesu.
