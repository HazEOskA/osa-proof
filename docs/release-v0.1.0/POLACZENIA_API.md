# Połączenia API i profile — checkpoint 17.10.2026

Zakres: istniejący Czat floty agentów, globalne Zapytaj OSĘ i Sekrety w tym samym frameworku. Przywrócono domyślnego Jeffa, Hermesa i wybór OpenRoutera. Dodano serwerowe połączenia NVIDIA/OpenRouter/OpenAI/Anthropic oraz zgodnych publicznych API przez istniejące adaptery. OpenRouter nie jest zastępowany NVIDIA, a zapisany wybór dostawcy przeżywa odświeżenie.

## Dane i koszt

Frontend wysyła nowy klucz do własnego endpointu zapisu, po czym czyści pole. API odczytu zwraca wyłącznie metadane. AES-256-GCM wiąże zaszyfrowaną konfigurację z właścicielem i dostawcą. Właściciela identyfikuje losowe HttpOnly/SameSite=Strict cookie, w chmurze również Secure. Mutacja połączenia wymaga zgodnego originu. Klucz nie trafia do historii ani frontend storage.

Nowy magazyn jest rzeczywistym bezpłatnym Postgres w projekcie osa-proof. Zaszyfrowane połączenia przeżywają nowy proces i instancję API, wygasają po 30 dniach i wymagają cookie właściciela. Test CAS odrzuca konflikt zapisu, a obcy właściciel nie odczytuje klucza. Konfiguracja, dowody i ograniczenia: [DURABILNOSC_2026-10-17.md](DURABILNOSC_2026-10-17.md). Środowisko bez tej konfiguracji nadal używa jawnego PROCESS_MEMORY do godziny. Nie provisionowano płatnej bazy.

NVIDIA w open nie wymaga już sesji operatora. Bez Redis limit jest lokalny 3/min i 30/h na instancję/klucz. Dokładny model `nvidia/nemotron-3-super-120b-a12b` jest wymieniony jako bezpłatny endpoint w oficjalnym katalogu NVIDIA; dostęp konta potwierdza dopiero rzeczywiste wywołanie. `openrouter/free` i warianty `:free` nie mają płatnego fallbacku. Pozostałe prywatne modele wymagają jawnej zgody na rozliczenie własnego konta. Ta zgoda w produkcie nie jest dowodem wykonania ani zgodą na nasze testy płatnych modeli.

## Dowody lokalne

- [Testy backendu](../evidence/release-v0.1.0/api-providers-2026-10-17/tests.txt): 251 łącznie, 247 PASS, 0 FAIL, 4 SKIP; `npm test` zawiera build backendu.
- [Worker Host](../evidence/release-v0.1.0/api-providers-2026-10-17/worker-build.txt) i [dashboard](../evidence/release-v0.1.0/api-providers-2026-10-17/dashboard-build.txt): poprawne buildy.
- `tests/provider-connections.test.ts`: rzeczywisty lokalny szyfrowany zapis, restart API, osobne cookies/właściciele, scope, integralność, współbieżny zapis; odmowa originu, SSRF i zmiany stałego endpointu; kontrolowany HTTP dla tekstu/historii oraz odmowa kosztu i narzędzi przed transportem.
- [Kontrakty UI 320/390/1440](../evidence/release-v0.1.0/api-providers-2026-10-17/ui-contracts.txt): Jeff, Hermes, OpenRouter po odświeżeniu, formularz API, czyszczenie pola, brak klucza w localStorage/sessionStorage, brak poziomego przepełnienia. Metadane/zapis/odpowiedzi dostawców są kontrolowane — nie stanowią dowodu dostawcy.
- [Natywny browser E2E](../evidence/release-v0.1.0/api-providers-2026-10-17/native-results.json): rzeczywisty lokalny Runtime, oba weryfikatory, Evidence/receipt, Replay do ostatniego zdarzenia, odświeżenie i odmowa zmienionego dowodu; bez podmiany transportu i bez generacji modelowej.

Natywne identyfikatory lokalne: `exec_403dc4ac-b179-4476-8f67-3734fb9d4103` (320), `exec_820f3e09-4634-4f4a-af5d-f543950f5d7e` (390), `exec_cd64c010-43a6-42f0-aee6-41004512fee2` (1440). To SHA-256 wybrane poleceniem użytkownika, nie modelowe tool_calls.

## Rzeczywisty model i granice dowodu

Po bieżącym zleceniu dokończenia ograniczonego zakresu wykonano dwa rzeczywiste bezpłatne żądania NVIDIA na Preview. Modelowy wynik z czatu, trwały odczyt i Replay 320/390/1440 są udokumentowane w [WERYFIKACJA.md](WERYFIKACJA.md). Nie wywołano rzeczywistych OpenAI/Anthropic/OpenRouter ani płatnego zamiennika. Starsze logi powyżej opisują historyczny checkpoint; bieżący npm test ma 250 PASS, 0 FAIL i 4 SKIP.

Podłączony execution host cloud i NeurOSA nadal nie mają dowodu integracji produkcyjnej; modelowy ONE FLOW i trwały rdzeń już go mają. CI i wdrożenie dokładnego SHA są zapisane w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). Instrukcja i rollback: [OPERATOR.md](OPERATOR.md). Formalny release pozostaje BLOCKED przez brak połączenia istniejącego Worker Hosta w zleconych trzech krokach.
