# OSA Proof v0.1.0 — przygotowane informacje o wydaniu

**Kandydat zablokowany; to nie jest ogłoszenie wydania.**

OSA Proof pozostaje jednym frameworkiem: konfiguracja agentów i grafu zespołu, rozmowa, Runtime, śledzenie, materiał dowodowy, deterministyczna weryfikacja i Replay. Zakres nie tworzy nowego dashboardu, repozytorium ani systemu pamięci.

Kandydat łączy globalny polski samouczek „Zapytaj OSĘ” z osobnym Czatem floty agentów. Jeff jest domyślnym profilem, Hermes pozostaje osobnym wyborem. Przywrócono wybór OpenRoutera i dodano formularz połączeń NVIDIA, OpenRouter, OpenAI, Anthropic oraz publicznych API zgodnych z OpenAI. Istniejące adaptery wykonują transport po stronie serwera. Klucz wpisany w formularzu nie wraca do klienta i nie jest zapisywany w historii ani magazynie przeglądarki.

Na wyraźne zlecenie operatora panel i NVIDIA w Vercel open nie wymagają logowania operatora. Tryb session pozostaje w kodzie. Domyślny Nemotron i OpenRouter free nie mają automatycznego płatnego zamiennika; użycie pozostałych prywatnych modeli wymaga zgody na rozliczenie własnego konta.

Podłączono bezpłatny Postgres do wykonań Unified, dowodów, receipts, Mission Kernel i zaszyfrowanych połączeń API. Odczyt w nowym procesie/instancji, równoległy CAS oraz izolacja podpisów Preview/produkcja przechodzą. Połączenia są serwerowo szyfrowane i wygasają po 30 dniach; nie są współdzielone między przeglądarkami. Kolejki, rejestr workerów, szkic Buildera i część konfiguracji nadal pozostają PROCESS_MEMORY. Zwykła historia czatu jest lokalna.

Testy UI obejmują 320/390/1440 px. Dwa rzeczywiste bezpłatne żądania NVIDIA na Preview zwróciły modelowe tool_calls. Wykonanie z czatu `exec_2b067264-0faf-4d82-b8a6-89b5e84978ff` przeszło Runtime → Events/Evidence/ProofReceipt → niezależną weryfikację → Postgres → Replay i odświeżenie w pustych przeglądarkach na trzech rozmiarach. Nieautoryzowany dispatch narzędzia zwrócił 403. Kontrolowane testy innych dostawców nadal nie są ich rzeczywistym dowodem.

Instrukcja: [OPERATOR.md](OPERATOR.md), macierz: [MACIERZ.md](MACIERZ.md), dowody API: [POLACZENIA_API.md](POLACZENIA_API.md). Bieżący commit, CI i wdrożenie: [PR #16](https://github.com/HazEOskA/osa-proof/pull/16).

## Następne aktualizacje

| Zakres | Cel |
|---|---|
| Warunki przed wydaniem v0.1.0 w zleconym zakresie | Podłączenie istniejącego Worker Hosta do Vercel i rzeczywisty odbiór sandboxa; model i trwały rdzeń już potwierdzone. Publiczny open jest decyzją operatora; limit bez Redis pozostaje lokalny |
| v0.1.x | Naprawy wykryte w odbiorze, stabilizacja trwałego odczytu/Replay, monitoring i dokumentacja aktualnego zakresu |
| v0.1.x — osobny import | Podłączenie zgodnego istniejącego adaptera NeurOSA i trwały import danych z jawnym zakresem; prywatna historia nie była importowana |
| v0.2 | Wielu użytkowników i OIDC/RBAC, autonomiczne workery, szersze narzędzia, pełne integracje MCP/A2A, dopuszczone cloud deploy i funkcje Regulated |

Odłożone funkcje nie są warunkiem sztucznego odblokowania menu; zachowują ograniczenia.
