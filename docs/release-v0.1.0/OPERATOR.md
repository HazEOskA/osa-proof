# Obsługa kandydata v0.1.0

## Uruchomienie lokalne

```bash
npm ci
npm test
npm run worker:build
node scripts/build-dashboard.cjs
```

Tryb `OSA_EXECUTION_MODE=fixture` jest jawnie testowy. `OSA_AUTH_MODE=open` jest dopuszczony wyłącznie dla lokalnego środowiska deweloperskiego; w chmurze nie omija sesji operatora. Host workerów bez Docker i prawdziwej izolacji pozostaje GATED.

## Wymagana konfiguracja Preview

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

Po wdrożeniu Preview `/api/auth/access` powinno raportować `required=true`, `configured=true`, `authenticated=false` bez sesji. Panel prosi o osobny kod operatora; kod nie jest utrwalany w storage, a sesja jest HttpOnly. Należy użyć dokładnie skonfigurowanego originu. Kod inicjalizujący nie działa jako Bearer do API.

`GET /api/nvidia/status` po logowaniu pokazuje `configured`, `available`, `gate` i rodzaj limitu. `available=true` oznacza przejście preflightu konfiguracji, nie udany test dostawcy ani potwierdzenie dostępnego salda.

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

Nie wdrażaj tej gałęzi do produkcji ani nie scalaj jej do main przed przejściem bramek i osobnym zatwierdzeniem. Produkcja bazowa to `512a6e1` / `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`.

Rollback Preview: zachowaj produkcję, anuluj/wyłącz wyłącznie problematyczne Preview i przywróć poprzedni zatwierdzony head gałęzi. Nie usuwaj dowodów. Ewentualne zmienne gałęzi usuwaj dopiero po identyfikacji ich ID i targetu; nie usuwaj wspólnych kluczy NVIDIA.

Rollback produkcji, jeśli wydanie zostanie później zatwierdzone: wybierz ostatni zatwierdzony deployment po sprawdzeniu jego zabezpieczeń i trwałego backendu; nie promuj automatycznie `512a6e1`, ponieważ ma `auth_mode=open`. Alternatywa to odwracający commit z zachowaniem nowych zabezpieczeń. Zmiana ochrony i redeploy produkcji wymagają osobnej zgody. Nie ma migracji bazy wykonanej przez ten PR.

Historia rozmów, szkic Buildera i lokalny bundle w chronionym środowisku mają osobne klucze storage dla organizacji/projektu potwierdzonych przez sesję. Stare zapisy bez zakresu pozostają na urządzeniu; nie są kasowane ani automatycznie importowane do chronionego projektu. To rozdzielenie widoków lokalnych, nie szyfrowany magazyn ani granica bezpieczeństwa między osobami korzystającymi z tego samego profilu przeglądarki.
