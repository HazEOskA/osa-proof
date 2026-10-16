# OSA Proof v0.1.0 — przygotowane informacje o wydaniu

**Kandydat zablokowany; to nie jest ogłoszenie wydania.**

OSA Proof pozostaje jednym frameworkiem: konfiguracja agentów i grafu zespołu, rozmowa, Runtime, śledzenie, materiał dowodowy, deterministyczna weryfikacja i Replay. Zakres nie tworzy nowego dashboardu, repozytorium ani systemu pamięci.

Kandydat łączy globalny polski samouczek „Zapytaj OSĘ” z osobnym Czatem floty agentów. Wzmacnia ochronę chmurowego API i kosztów, dopuszcza wyłącznie serwerowy klucz/model NVIDIA i ograniczone narzędzie SHA-256 wybrane przez model. Wykonanie ma jeden execution_id, a receipt i dowody przechodzą osobną walidację.

Gotowość modelu i infrastruktury jest jawna. Brak działającego bezpłatnego dostępu, wspólnego licznika, trwałego backendu lub izolowanego workera pozostawia odpowiednie funkcje GATED/BLOCKED. Lokalna historia i ponownie zweryfikowany bundle nie oznaczają trwałości w chmurze.

Pełna ścieżka NVIDIA na Preview, trwały zapis serverless i wdrożenie zabezpieczeń na produkcję pozostają niespełnionymi warunkami. Szczegóły: [BRAMKI.md](BRAMKI.md), [MACIERZ.md](MACIERZ.md), [WERYFIKACJA.md](WERYFIKACJA.md).

## Następne aktualizacje

| Zakres | Cel |
|---|---|
| Warunki przed wydaniem v0.1.0 | Bezpieczny Preview, rzeczywiste bezpłatne modelowe tool_calls, współdzielony limit, trwały backend, komplet dowodów i osobna zgoda na produkcję |
| v0.1.x | Naprawy wykryte w odbiorze, stabilizacja trwałego odczytu/Replay, monitoring i dokumentacja aktualnego zakresu |
| v0.1.x — osobny import | Podłączenie zgodnego istniejącego adaptera NeurOSA i trwały import danych z jawnym zakresem; prywatna historia nie była importowana |
| v0.2 | Wielu użytkowników i OIDC/RBAC, autonomiczne workery, szersze narzędzia, pełne integracje MCP/A2A, dopuszczone cloud deploy i funkcje Regulated |

Odłożone funkcje nie są warunkiem sztucznego odblokowania menu; zachowują ograniczenia.
