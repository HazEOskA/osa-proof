# Most NVIDIA w OSA Proof

Modele NVIDIA oraz Czat floty agentów korzystają z tego samego serwerowego mostu. Globalny przewodnik „Zapytaj OSĘ” ma osobny, allowlistowany kontekst modułu i nie wykonuje narzędzi.

Klucz `NVIDIA_API_KEY` jest przechowywany wyłącznie w środowisku serwera. Panel nie przyjmuje własnego klucza dostawcy. HTTP odrzuca pole `apiKey` i ID modelu inne niż skonfigurowane na serwerze. Nie zapisuj sekretów w promptach ani zasobach Buildera.

Panel i natywne wykonania Vercel Preview oraz produkcji w jawnym `OSA_AUTH_MODE=open` działają bez obowiązkowego logowania. Wywołania NVIDIA nadal wymagają podpisanej sesji operatora oraz zgodnego originu; otwarty panel nie wyłącza autoryzacji modelu ani polityki kosztowej. `/auth/dev-login` pozostaje wyłączone w chmurze. Vercel SSO jest osobnym ustawieniem i nie zostało zmienione.

`GET /api/nvidia/status` w otwartym Preview jest dostępne bez logowania i zwraca `configured`, `available`, `gate` i rodzaj limitu. Obecny klucz nie oznacza udanego wykonania. Model jest blokowany bez aktywnej polityki zerowych kosztów, aktualnego potwierdzenia bezpłatnego modelu i współdzielonego limitu. Pełna konfiguracja: [instrukcja operatora](release-v0.1.0/OPERATOR.md).

`POST /api/nvidia/chat` przyjmuje prompt; `POST /api/nvidia/fleet-chat` dodatkowo profil, ograniczoną historię i allowlistowany kontekst przewodnika. Maksymalnie 8000 znaków promptu, 40000 bajtów żądania, 1024 tokeny odpowiedzi, 25 sekund połączenia. Brak automatycznych retry i płatnego zamiennika. Odpowiedź dostawcy jest ograniczona do 256000 bajtów, a błędy są sanitowane.

Tryb `execute_tools=true` floty wymaga poprawnego `execution_id`. Do modelu trafia wyłącznie definicja odczytowego `osa_sha256`. Tylko rzeczywiste `tool_calls` z poprawnym narzędziem, argumentami i metadanymi dostawcy uruchamiają istniejący Runtime i tworzą bundle dowodów. Zwykła odpowiedź modelu ma status `PROVIDER_RESPONSE` i nie jest proof. Deterministyczne natywne polecenia są oddzielnym trybem i nie zaliczają modelowego E2E.

Dowód wiąże żądany/raportowany model, ID odpowiedzi i skróty. To obserwacja serwera i integralność bundle, nie poświadczenie kryptograficzne wystawione przez NVIDIA. Testy symulowanego transportu potwierdzają kontrakt, nie działanie rzeczywistego konta.

Dokumentacja dostawcy:
- https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b
- https://docs.api.nvidia.com/nim/docs/product

Rzeczywisty ONE FLOW na Preview pozostaje obowiązkową bramką wydania. Aktualny stan: [bramki](release-v0.1.0/BRAMKI.md).

## NVIDIA hotfix — 24 października 2026 (model i parsowanie)

**Model domyślny:** `openai/gpt-oss-20b` na **NVIDIA Build**, endpoint `https://integrate.api.nvidia.com/v1/chat/completions` (to nie jest połączenie z OpenAI API). Dokumentacja NVIDIA oznacza go jako **Free Endpoint**: https://build.nvidia.com/openai/gpt-oss-20b. Production wymaga `OSA_ZERO_COST_ONLY=true`; bez tego nie uznajemy środowiska za spełniające politykę kosztów. Inne modele nie są automatycznym fallbackiem.

**Udokumentowana awaria (2026-10-24):** ten sam klucz NVIDIA zwrócił 200 dla katalogu `GET /v1/models`, 404 dla `nvidia/nemotron-3-super-120b-a12b` przy `POST /v1/chat/completions` i 200 dla `openai/gpt-oss-20b` przy inferencji. Nie wynika z tego brak uprawnień całego konta. Nie należy zmieniać klucza na podstawie samego HTTP 404; nie wolno ponawiać operacji o niepewnym wyniku automatycznie.

**Zgodność odpowiedzi:** dostawca może zwrócić `tool_calls: []`. Pusta tablica oznacza **brak wywołania narzędzia**, natomiast tablica niepusta nadal wymaga zatwierdzonej definicji, argumentów i rzeczywistego, zweryfikowanego proof. Błędy HTTP 404/410 otrzymują osobne, sanitowane kody `NVIDIA_INFERENCE_HTTP_404` / `NVIDIA_INFERENCE_HTTP_410`; 401/403 → `NVIDIA_INFERENCE_ACCESS_DENIED`. Bez ukrytych retry i bez logowania surowych danych od dostawcy.

**Zakres proof:** na izolowanym Preview P1 pełny czat z `openai/gpt-oss-20b` zwrócił `PROVIDER_RESPONSE` z trwałą rezerwacją `exec_2f89a8c3-1be2-4390-9364-abcd529b7421` o stanie `COMPLETED`, rewizja 4 w Postgres. To **nie** jest nowy dowód Worker → ProofReceipt; P1/NeurOSA i osobny PR #18 pozostają odrębnym zakresem. Aktualizacja Production wymaga osobnego health/status i weryfikacji po wdrożeniu, bez wykonywania płatnych modeli.
