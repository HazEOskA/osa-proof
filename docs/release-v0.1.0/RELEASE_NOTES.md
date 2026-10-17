# OSA Proof v0.1.0 — przygotowane informacje o wydaniu

**Kandydat zablokowany; to nie jest ogłoszenie wydania.**

OSA Proof pozostaje jednym frameworkiem: konfiguracja agentów i grafu zespołu, rozmowa, Runtime, śledzenie, materiał dowodowy, deterministyczna weryfikacja i Replay. Zakres nie tworzy nowego dashboardu, repozytorium ani systemu pamięci.

Kandydat łączy globalny polski samouczek „Zapytaj OSĘ” z osobnym Czatem floty agentów. Jeff jest domyślnym profilem, Hermes pozostaje osobnym wyborem. Przywrócono wybór OpenRoutera i dodano formularz połączeń NVIDIA, OpenRouter, OpenAI, Anthropic oraz publicznych API zgodnych z OpenAI. Istniejące adaptery wykonują transport po stronie serwera. Klucz wpisany w formularzu nie wraca do klienta i nie jest zapisywany w historii ani magazynie przeglądarki.

Na wyraźne zlecenie operatora panel i NVIDIA w Vercel open nie wymagają logowania operatora. Tryb session pozostaje w kodzie. Domyślny Nemotron i OpenRouter free nie mają automatycznego płatnego zamiennika; użycie pozostałych prywatnych modeli wymaga zgody na rozliczenie własnego konta.

Połączenia API na obecnym Vercel działają w szyfrowanej pamięci procesu do godziny i mogą zniknąć przy zmianie instancji. Lokalny szyfrowany plik przechodzi test restartu i zapisu współbieżnego. Trwały magazyn chmurowy nie został podłączony. Historia, misje, kolejki i lokalny eksport bundle zachowują opisane ograniczenia trwałości.

Testy UI obejmują 320/390/1440 px. Kontrolowane odpowiedzi dostawców służą tylko do testu interfejsu/transportu. Rzeczywisty lokalny Runtime → Evidence → ProofReceipt → niezależna weryfikacja → Replay przeszedł trzy rozmiary. Pełna ścieżka modelowa nadal nie ma dowodu: automatyczna kontrola odrzuciła próbę NVIDIA z narzędziem w produkcji z powodu braku osobnej zgody na koszt i zakres. Nie ogłaszamy wydania na podstawie tej próby.

Instrukcja: [OPERATOR.md](OPERATOR.md), macierz: [MACIERZ.md](MACIERZ.md), dowody API: [POLACZENIA_API.md](POLACZENIA_API.md). Bieżący commit, CI i wdrożenie: [PR #16](https://github.com/HazEOskA/osa-proof/pull/16).

## Następne aktualizacje

| Zakres | Cel |
|---|---|
| Warunki przed wydaniem v0.1.0 | Rzeczywiste bezpłatne modelowe tool_calls, komplet dowodów, trwały backend i uzgodniona polityka publicznego dostępu/limitu; bieżące wdrożenie produkcyjne jest już zlecone |
| v0.1.x | Naprawy wykryte w odbiorze, stabilizacja trwałego odczytu/Replay, monitoring i dokumentacja aktualnego zakresu |
| v0.1.x — osobny import | Podłączenie zgodnego istniejącego adaptera NeurOSA i trwały import danych z jawnym zakresem; prywatna historia nie była importowana |
| v0.2 | Wielu użytkowników i OIDC/RBAC, autonomiczne workery, szersze narzędzia, pełne integracje MCP/A2A, dopuszczone cloud deploy i funkcje Regulated |

Odłożone funkcje nie są warunkiem sztucznego odblokowania menu; zachowują ograniczenia.
