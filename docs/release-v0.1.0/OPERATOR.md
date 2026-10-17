# Obsługa kandydata v0.1.0

## Uruchomienie lokalne

```bash
npm ci
npm test
npm run worker:build
node scripts/build-dashboard.cjs
```

Tryb `OSA_EXECUTION_MODE=fixture` jest jawnie testowy. `OSA_AUTH_MODE=open` udostępnia środowisko lokalne oraz Vercel Preview/produkcję bez obowiązkowego logowania. W Vercel wymaga jednocześnie `VERCEL=1` oraz `VERCEL_ENV=preview` lub `production`; nie obejmuje autoryzacji wywołań NVIDIA. Host workerów bez Docker i prawdziwej izolacji pozostaje GATED.

## Preview bez logowania

Panel otwiera się bez kodu operatora. `GET /api/auth/access` ma zwracać `required=false`, `mode=OPEN_PREVIEW`, a `/api/build/status` — HTTP 200 i `auth_mode=open`. Działają natywne wykonania i weryfikacja dowodów. Jest to wspólne środowisko testowe z tożsamością `org_dev_local`, bez izolacji danych różnych odwiedzających. Vercel SSO jest osobnym ustawieniem; ta korekta go nie zmienia.

## Konfiguracja chronionych wywołań modelu

Zmienne należy wpisać w bezpiecznym panelu Vercel, z targetem **Preview** i ograniczeniem do gałęzi `release/osa-proof-v0.1.0`. Nie wklejaj wartości sekretów do czatu, kodu, testów, logów ani promptów. Ten PR nie ustawia zmiennych projektu i nie zmienia produkcji.

| Zmienna | Wartość / warunek |
|---|---|
| `OSA_OPERATOR_TOKEN` | Osobny, losowy sekret o co najmniej 256 bitach entropii; nie klucz dostawcy |
| `OSA_OPERATOR_ORGANIZATION_ID` | Organizacja zgodna z istniejącym Team Graph; obecny snapshot używa `org_osa` |
| `OSA_OPERATOR_PROJECT_ID` | Projekt zgodny z istniejącym Team Graph; obecny snapshot używa `prj_osa_proof` |
| `OSA_OPERATOR_ORIGIN` | Dokładny origin HTTPS Preview; bez ścieżki. Gdy brak, używany jest unikalny `VERCEL_URL` |
| `NVIDIA_API_KEY` | Istniejący sekret dostawcy wyłącznie po stronie serwera |
| `NVIDIA_MODEL` | Jeden zatwierdzony model, bez automatycznego fallbacku |
| `OSA_ZERO_COST_ONLY` | `true` |
| `OSA_NVIDIA_FREE_TIER_ACK` | `true` wyłącznie po sprawdzeniu konta i zakresu bezpłatnego dostępu |
| `OSA_NVIDIA_FREE_MODELS` | Dokładne ID potwierdzonego bezpłatnego modelu |
| `OSA_NVIDIA_FREE_UNTIL` | Czas ISO w przyszłości, nie dalej niż 24 godziny; wygaszenie blokuje model |
| `OSA_QUOTA_REDIS_REST_URL` | Origin HTTPS istniejącego zgodnego Redis REST, bez query/ścieżki/hasła |
| `OSA_QUOTA_REDIS_REST_TOKEN` | Serwerowy sekret do atomowego EVAL, tylko niezbędne uprawnienia |

Nie twórz automatycznie bazy, nie włączaj płatnego planu i nie kopiuj sekretów między targetami. Wymagany jest test rzeczywistego licznika przez dwie niezależne instancje; sama obecność zmiennych nie dowodzi działania.

Otwarty panel nie wymaga zmiennych operatora. Są one nadal potrzebne do autoryzowanego testu NVIDIA. Sesję wydaje istniejące `POST /api/auth/operator-login` po sprawdzeniu kodu i dokładnie skonfigurowanego originu. Cookie jest HttpOnly; kod inicjalizujący nie działa jako Bearer do API. Aby przywrócić ekran logowania w Preview, ustaw `OSA_AUTH_MODE=session` wyłącznie dla tej gałęzi i wykonaj redeploy Preview.

`GET /api/nvidia/status` w otwartym Preview bez logowania pokazuje `configured`, `available`, `gate` i rodzaj limitu. `available=true` oznacza przejście preflightu konfiguracji, nie udany test dostawcy ani potwierdzenie dostępnego salda.

## Test prawdziwego przepływu

1. W Czat floty agentów wybierz NVIDIA i włącz „Narzędzia modelu · tylko SHA-256, bez zmian”.
2. Wyślij prośbę o SHA-256 krótkiego publicznego tekstu. Żądanie trafia do modelu z definicją narzędzia; nie przechodzi przez deterministyczny router.
3. Jeśli model nie zwróci `tool_calls`, sama odpowiedź tekstowa nie zalicza bramki. Niedozwolone narzędzie i brak ID/modelu dostawcy kończą się odmową.
4. Zapisz rzeczywiste `execution_id`, `provider_response_id`, model, receipt i wyniki obu weryfikatorów. Otwórz Śledzenie, Dowody i Odtwarzanie. Powtórz kontrolę na 320/390/1440 px.
5. Odśwież. Bundle przywrócony lokalnie musi ponownie przejść walidację. Następnie sprawdź trwały odczyt z nowej instancji i innego urządzenia — obecna wersja tej bramki nie spełnia.
6. W nowej sesji bez cookie API ma odmówić przed wywołaniem modelu. Osobno sprawdź odmowę obcego narzędzia i zmodyfikowanego dowodu.

Przewodnik „Zapytaj OSĘ” pozostaje samouczkiem bez prawa wykonywania narzędzi.

## Trwałość

- `ApiState`, konfiguracje i kolejki: pamięć procesu, utrata po restarcie/zmianie instancji.
- `FileMissionStore`: trwałość na tym samym lokalnym dysku, CAS i blokada pliku; bez gwarancji rozproszonej.
- Czat i eksport ostatniego bundle: localStorage tego urządzenia. Nie synchronizują się między użytkownikami/urządzeniami i nie stanowią zabezpieczonego backendu historii.
- Cookie operatora: podpis stateless, 30 minut, niezależny od instancji. Rotacja `OSA_OPERATOR_TOKEN` unieważnia sesje.
- NeurOSA: GATED; w ramach wydania nie importujemy prywatnej historii. Istniejący adapter HB wymaga zgodnego upstream oraz konfiguracji `OSA_NEUROSA_*` opisanej w kodzie; nie należy uznawać go za połączony na podstawie samego `/health` innego serwisu.

## Rollback i produkcja

Operator osobno zlecił wdrożenie tej gałęzi na produkcję w celu sprawdzenia panelu bez obowiązkowego logowania. To nie jest formalne wydanie v0.1.0 i nie obejmuje merge do main. Produkcja bazowa i punkt cofnięcia tej operacji to `512a6e1` / `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`. Szczegóły: [WDROZENIE_PRODUKCJA.md](WDROZENIE_PRODUKCJA.md).

Rollback Preview: zachowaj produkcję, anuluj/wyłącz wyłącznie problematyczne Preview i przywróć poprzedni zatwierdzony head gałęzi. Nie usuwaj dowodów. Ewentualne zmienne gałęzi usuwaj dopiero po identyfikacji ich ID i targetu; nie usuwaj wspólnych kluczy NVIDIA.

Rollback bieżącego wdrożenia testowego: przywróć poprzedni produkcyjny deployment wskazany wyżej. Odtwarza to wcześniejszy stan open, a nie docelową ochronę wieloużytkownikową. Nie wykonano migracji bazy ani zmiany sekretów. Dalsze zmiany ochrony, infrastruktury i formalne wydanie wymagają osobnego zakresu.

Historia rozmów, szkic Buildera i lokalny bundle w chronionym środowisku mają osobne klucze storage dla organizacji/projektu potwierdzonych przez sesję. Stare zapisy bez zakresu pozostają na urządzeniu; nie są kasowane ani automatycznie importowane do chronionego projektu. To rozdzielenie widoków lokalnych, nie szyfrowany magazyn ani granica bezpieczeństwa między osobami korzystającymi z tego samego profilu przeglądarki.
