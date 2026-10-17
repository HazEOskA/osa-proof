# Historia zmian

## 0.1.0 — kandydat, niewydany

Status wydania: **BLOCKED**. Nie utworzono tagu ani GitHub Release.

- Przywrócono Jeffa jako domyślny profil, Hermesa i wybór OpenRoutera w Czacie floty agentów. Profile nie są deklaracją autonomicznego workera.
- Dodano serwerowe połączenia NVIDIA, OpenRouter, OpenAI, Anthropic i zgodnych publicznych API, konfigurowane z istniejącego panelu oraz czatu. Klucz nie wraca z API ani nie trafia do historii/localStorage/sessionStorage.
- Połączenia w obecnym Vercel są szyfrowane w PROCESS_MEMORY przez maksymalnie godzinę; zmiana instancji może je utracić. Lokalny szyfrowany zapis przechodzi test restartu. Opcjonalny adapter Postgres pozostaje niezweryfikowany i niepodłączony.
- Na wyraźne zlecenie operatora NVIDIA w trybie open nie wymaga sesji operatora. Dokładny domyślny Nemotron korzysta z publicznie udokumentowanego bezpłatnego endpointu; pozostałe modele zachowują kontrolę kosztu. Bez Redis limit w open jest lokalny dla instancji, nie rozproszony.
- Dodano kontrolę kosztu prywatnych połączeń i testy formularza API, Jeffa, Hermesa oraz zachowania wyboru OpenRoutera przy 320/390/1440 px. Rzeczywiste wywołanie modelowe pozostaje niezaliczone; kontrolowane odpowiedzi testów nie są jego dowodem.
- Naprawiono konfigurację istniejącego Worker Hosta: organizacja/projekt w Compose, aktualna gałąź, prywatny plik env, zachowanie tokenu i sieć none jako default nowego sandboxa.
- Włączono rzeczywiste testy Docker i Worker Host HTTP w istniejącym CI; ich wynik i granice dowodów muszą być sprawdzone dla bieżącego commitu.

- Włączono zakres globalnego przewodnika „Zapytaj OSĘ” z PR #15, zachowując osobny Czat floty agentów i istniejący polski interfejs.
- Na życzenie operatora Preview i produkcja Vercel w jawnym `OSA_AUTH_MODE=open` otwierają panel i NVIDIA bez obowiązkowego logowania. Tryb session pozostaje dostępny w kodzie.
- Klucze pozostają po stronie serwera; adapter współdzielonego limitu żądań wymaga osobnego podłączenia, bez tworzenia infrastruktury w tym wydaniu.
- Dodano transport walidowanych modelowych tool_calls do istniejącego Runtime dla odczytowego SHA-256. Testy z symulowanym dostawcą nie są dowodem działania NVIDIA.
- Dodano weryfikowany lokalny eksport wyniku po odświeżeniu oraz jawne ograniczenia PROCESS_MEMORY.
- Dodano testy odmów dostępu, zakresów, kosztów, transportu i integralności oraz kompilację worker hosta w CI.

Bramki, dowody i ograniczenia: [docs/release-v0.1.0/BRAMKI.md](docs/release-v0.1.0/BRAMKI.md).
