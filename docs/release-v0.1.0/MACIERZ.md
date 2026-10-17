# Macierz możliwości i ograniczeń v0.1.0

Macierz dotyczy zakresu dowodów z tego PR, nie deklarowanej gotowości wszystkich środowisk. `VERIFIED` zawsze ma podany zakres. Zielony test z symulowanym dostawcą nie dowodzi działania usługi zewnętrznej.

| Warstwa | Status | Dowód i zakres | Ograniczenie / warunek |
|---|---|---|---|
| Agenci i profile floty | PARTIAL | Jeff domyślny, Hermes i pozostałe profile; wybór oraz odtworzenie po odświeżeniu w testach UI 320/390/1440 | Profile rozmowy nie dowodzą autonomicznej pracy ról |
| Team Graph | VERIFIED | `tests/backend.test.ts`, `tests/build-workspace.test.ts`, `tests/mission-kernel.test.ts`: walidacja, zakres, handoff, wersja | Zweryfikowany kontrakt i lokalne wykonanie; nie cała flota cloud |
| Modele NVIDIA | IMPLEMENTED_UNVERIFIED | Serwerowy klucz, transport i testy odmów; usunięta sesja operatora w open; oficjalny katalog podaje bezpłatny endpoint domyślnego Nemotrona | Brak udanego bieżącego testu konta/modelu; próba live odrzucona przez automatyczną kontrolę. Bez Redis limit open jest lokalny |
| OpenRouter / OpenAI / Anthropic / zgodne API | IMPLEMENTED_UNVERIFIED | Istniejące adaptery rozszerzone o zwykły czat i historię; lokalne kontrakty HTTP oraz formularz 320/390/1440 | Nie wykonano rzeczywistego wywołania tych dostawców ani płatnego fallbacku; wymagany własny klucz/model |
| Połączenia i klucze API | PARTIAL | Rzeczywisty lokalny szyfrowany zapis, restart, zapis współbieżny, integralność, izolacja cookie i brak klucza w odpowiedziach; test UI bez frontend storage | Vercel PROCESS_MEMORY do godziny/zmiany instancji; Postgres niepodłączony i niezweryfikowany |
| Modelowe tool_calls | IMPLEMENTED_UNVERIFIED | Symulowany dostawca → rzeczywisty Runtime w `tests/release-security.test.ts` | Nie wykonano rzeczywistego modelowego testu NVIDIA |
| Runtime | VERIFIED | Lokalny SHA-256 przez HTTP i przeglądarkę; testy Runtime oraz Mission Kernel | Dowód dotyczy natywnego wykonawcy, nie modelu i infrastruktury cloud |
| Narzędzia natywne | VERIFIED | SHA-256, odmowa obcego narzędzia, integralność receipt; `tests/unified-runtime.test.ts`, `tests/unified-p0.test.ts` | Ścieżka deterministyczna jest oznaczona osobno; do modelu dopuszczono tylko SHA-256 |
| Zapytaj OSĘ | PARTIAL | Globalny dock, kontekst i przejścia 320/390/1440; `scripts/test-osa-guide-browser.mjs` | Odpowiedź dostawcy w teście jest symulowana; brak live testu przewodnika |
| Native Builder | GATED | Testy podpisanego zatwierdzenia; rzeczywisty build/test Node w sandboxach CI | Nie wykonano płatnego CLI Claude/Codex ani zmian w repo użytkownika; wymagany zatwierdzony runner/model i grant konkretnego wykonania |
| Worker Host | PARTIAL | Rzeczywisty Worker Host HTTP → Docker → Runtime → MissionReceipt w CI; niezależna weryfikacja pobranego dowodu | Host działał na runnerze CI; Vercel nie ma połączenia z wdrożonym hostem operatora |
| Sandbox Docker | VERIFIED | Prawdziwe kontenery, UID 1000, sieć none, odmowa zapisu do /etc, dwie misje, potwierdzony cleanup | Dowód dotyczy runtime CI; nie jest dowodem provisioningu Azure ani obrazu opublikowanego w registry |
| Misje | PARTIAL | Stan i receipts Mission Kernel, testy restartu oraz współbieżnego zapisu lokalnych plików | W Vercel PROCESS_MEMORY; brak trwałej chmurowej historii |
| Kolejki i flota | PARTIAL | Lokalne testy lease/fencing/scope w `tests/platform-v05.test.ts` | Brak trwałej kolejki i rzeczywistych autonomicznych workerów cloud |
| Wiedza / pamięć procesu | PARTIAL | `tests/knowledge.test.ts`, wersje i wyszukiwanie lokalne | Pamięć procesu nie jest pamięcią trwałą |
| NeurOSA | GATED | `brain.memory=NONE` na produkcji; istniejący adapter w `packages/adapters/src/brain.ts` | Brak konfiguracji/połączenia na Preview; kompatybilność rzeczywistego upstream niezweryfikowana |
| Web3 | PARTIAL | Polityki odczytu, utrzymanie precyzji kwot i proof w testach lokalnych | RPC w testach kontrolowane; nie zaliczono live blockchain; zapis/podpisywanie pozostaje zablokowane |
| Tracing / Events | VERIFIED | Rzeczywiste lokalne zdarzenia Runtime, spójne execution_id i kolejność | Pełne payloady zdarzeń Unified nie są objęte rootem receipt v2 |
| Evidence / ProofReceipt | VERIFIED | Backendowy verifier, niezależny verifier przeglądarki, testy usuwania i modyfikacji dowodów | Integralność nie potwierdza prawdy dowolnego źródła ani nie stanowi podpisu NVIDIA |
| Replay | PARTIAL | Lokalny przebieg Runtime i przywracanie zweryfikowanego bundle po odświeżeniu | Zapis na tym urządzeniu; brak trwałego odczytu z chmury i pełnego seal payloadów Unified |
| Integracje usług | IMPLEMENTED_UNVERIFIED | Adaptery, kontrakty HTTP/SSE i testy odmów | Brak dowodu działania skonfigurowanych usług cloud w tym wydaniu |
| MCP | GATED | Istnieje ograniczony adapter JSON Streamable HTTP; test kontrolowanego serwera | Produktowe API raportuje UNSUPPORTED; brak potwierdzonej integracji live |
| A2A | PLANNED | API raportuje UNSUPPORTED | Brak dowodu i aktywnego protokołu |
| Cloud deploy | GATED | Istniejący AzureContainerAppsProvider i publisher; poprawiony bootstrap; produkcyjne cloud_providers=[] | Brak podłączonego execution hosta, registry/IAM i zatwierdzonego zakresu kosztu dla nowego provisioningu; nie wykonano Azure deploy |
| Regulated | GATED | `tests/layers.test.ts`, backendowy gate | Brak weryfikacji organizacji, afiliacji i entitlementów |
| Dostęp operatora | PARTIAL | Testy podpisu, originu, projektu, wygaśnięcia i odmów w session; open obejmuje teraz NVIDIA bez sesji operatora | Publiczny wspólny panel na życzenie operatora; brak pełnej izolacji użytkowników. Prywatne połączenia API należą do osobnych cookies HttpOnly |
| Wielu użytkowników / IAM | PLANNED | Jawny zakres pojedynczego operatora | Brak OIDC, zarządzania użytkownikami, pełnego RBAC i odwoływania pojedynczych sesji |
| Control plane | PARTIAL | Istniejący wspólny ApiState i polski UI; testy API | Brak drugiego control plane; PROCESS_MEMORY pozostaje ograniczeniem |
| Trwałość serverless | BLOCKED | `/api/build/status`, nowa instancja nie posiada poprzednich rekordów | Wymagany rzeczywisty trwały backend; localStorage i lokalne pliki nie wystarczą |
| Pełny ONE FLOW na Preview | BLOCKED | Natywny Runtime i Replay działają; brak potwierdzonego modelowego cloud execution_id | Wymagany rzeczywisty modelowy tool_call, oba weryfikatory, Replay i jawna akceptacja publicznego trybu open; test live odrzucony przez automatyczną kontrolę |

Raport wykonanych kontroli i identyfikatory: [WERYFIKACJA.md](WERYFIKACJA.md).
