# Most NVIDIA w OSA Proof

Modele NVIDIA oraz Czat floty agentów korzystają z tego samego serwerowego mostu. Globalny przewodnik „Zapytaj OSĘ” ma osobny, allowlistowany kontekst modułu i nie wykonuje narzędzi.

Klucz `NVIDIA_API_KEY` jest przechowywany wyłącznie w środowisku serwera. Panel nie przyjmuje własnego klucza dostawcy. HTTP odrzuca pole `apiKey` i ID modelu inne niż skonfigurowane na serwerze. Nie zapisuj sekretów w promptach ani zasobach Buildera.

W chmurze każda trasa wymaga podpisanej sesji operatora ograniczonej do organizacji, projektu i originu. `OSA_AUTH_MODE=open` i `/auth/dev-login` nie obchodzą ochrony. Vercel SSO Preview jest dodatkową granicą i nie dowodzi ochrony produkcji.

`GET /api/nvidia/status` po uwierzytelnieniu zwraca `configured`, `available`, `gate` i rodzaj limitu. Obecny klucz nie oznacza udanego wykonania. Model jest blokowany bez aktywnej polityki zerowych kosztów, aktualnego potwierdzenia bezpłatnego modelu i współdzielonego limitu. Pełna konfiguracja: [instrukcja operatora](release-v0.1.0/OPERATOR.md).

`POST /api/nvidia/chat` przyjmuje prompt; `POST /api/nvidia/fleet-chat` dodatkowo profil, ograniczoną historię i allowlistowany kontekst przewodnika. Maksymalnie 8000 znaków promptu, 40000 bajtów żądania, 1024 tokeny odpowiedzi, 25 sekund połączenia. Brak automatycznych retry i płatnego zamiennika. Odpowiedź dostawcy jest ograniczona do 256000 bajtów, a błędy są sanitowane.

Tryb `execute_tools=true` floty wymaga poprawnego `execution_id`. Do modelu trafia wyłącznie definicja odczytowego `osa_sha256`. Tylko rzeczywiste `tool_calls` z poprawnym narzędziem, argumentami i metadanymi dostawcy uruchamiają istniejący Runtime i tworzą bundle dowodów. Zwykła odpowiedź modelu ma status `PROVIDER_RESPONSE` i nie jest proof. Deterministyczne natywne polecenia są oddzielnym trybem i nie zaliczają modelowego E2E.

Dowód wiąże żądany/raportowany model, ID odpowiedzi i skróty. To obserwacja serwera i integralność bundle, nie poświadczenie kryptograficzne wystawione przez NVIDIA. Testy symulowanego transportu potwierdzają kontrakt, nie działanie rzeczywistego konta.

Dokumentacja dostawcy:
- https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b
- https://docs.api.nvidia.com/nim/docs/product

Rzeczywisty ONE FLOW na Preview pozostaje obowiązkową bramką wydania. Aktualny stan: [bramki](release-v0.1.0/BRAMKI.md).
