# Macierz możliwości i ograniczeń v0.1.0

Macierz dotyczy zakresu dowodów z tego PR, nie deklarowanej gotowości wszystkich środowisk. `VERIFIED` zawsze ma podany zakres. Zielony test z symulowanym dostawcą nie dowodzi działania usługi zewnętrznej.

| Warstwa | Status | Dowód i zakres | Ograniczenie / warunek |
|---|---|---|---|
| Agenci i profile floty | PARTIAL | Edytor Team Graph, wybór profilu i test transportu UI | Profile rozmowy nie dowodzą autonomicznej pracy ról |
| Team Graph | VERIFIED | `tests/backend.test.ts`, `tests/build-workspace.test.ts`, `tests/mission-kernel.test.ts`: walidacja, zakres, handoff, wersja | Zweryfikowany kontrakt i lokalne wykonanie; nie cała flota cloud |
| Modele NVIDIA | GATED | Odczyt produkcyjnego statusu: klucz skonfigurowany; `tests/nvidia.test.ts` i `tests/release-security.test.ts` | Brak potwierdzenia uprawnień konta/zerowej ceny i wspólnego licznika na Preview |
| Modelowe tool_calls | IMPLEMENTED_UNVERIFIED | Symulowany dostawca → rzeczywisty Runtime w `tests/release-security.test.ts` | Nie wykonano rzeczywistego modelowego testu NVIDIA |
| Runtime | VERIFIED | Lokalny SHA-256 przez HTTP i przeglądarkę; testy Runtime oraz Mission Kernel | Dowód dotyczy natywnego wykonawcy, nie modelu i infrastruktury cloud |
| Narzędzia natywne | VERIFIED | SHA-256, odmowa obcego narzędzia, integralność receipt; `tests/unified-runtime.test.ts`, `tests/unified-p0.test.ts` | Ścieżka deterministyczna jest oznaczona osobno; do modelu dopuszczono tylko SHA-256 |
| Zapytaj OSĘ | PARTIAL | Globalny dock, kontekst i przejścia 320/390/1440; `scripts/test-osa-guide-browser.mjs` | Odpowiedź dostawcy w teście jest symulowana; brak live testu przewodnika |
| Native Builder | GATED | `packages/builder-core/src`, testy podpisanego zatwierdzenia i odmowy | Brak dostępnego Docker/worker sandbox; nie wykonano prawdziwego builda w izolacji |
| Worker Host | GATED | Kompilacja hosta i test HTTP protokołu z kontrolowanym providerem | Health lub symulowany WorkspaceProvider nie dowodzi izolacji kontenera |
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
| Cloud deploy | GATED | Adaptery i przegląd planu; `deployment_execution_enabled=false` | Brak zgody na wykonanie; nie provisionowano infrastruktury |
| Regulated | GATED | `tests/layers.test.ts`, backendowy gate | Brak weryfikacji organizacji, afiliacji i entitlementów |
| Dostęp operatora | IMPLEMENTED_UNVERIFIED | Testy odmowy, podpisu, originu, projektu, wygaśnięcia i nowej instancji | W kodzie jeden operator; brak aktywacji i live testu tego mechanizmu na Preview |
| Wielu użytkowników / IAM | PLANNED | Jawny zakres pojedynczego operatora | Brak OIDC, zarządzania użytkownikami, pełnego RBAC i odwoływania pojedynczych sesji |
| Control plane | PARTIAL | Istniejący wspólny ApiState i polski UI; testy API | Brak drugiego control plane; PROCESS_MEMORY pozostaje ograniczeniem |
| Trwałość serverless | BLOCKED | `/api/build/status`, nowa instancja nie posiada poprzednich rekordów | Wymagany rzeczywisty trwały backend; localStorage i lokalne pliki nie wystarczą |
| Pełny ONE FLOW na Preview | BLOCKED | Brak nowego potwierdzonego cloud execution_id | Wymagane aktywne auth, zerowy koszt, wspólny limit, rzeczywisty model oraz komplet dowodów |

Raport wykonanych kontroli i identyfikatory: [WERYFIKACJA.md](WERYFIKACJA.md).
