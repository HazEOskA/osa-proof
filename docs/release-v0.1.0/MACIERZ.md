# Macierz możliwości i ograniczeń v0.1.0

Aktualny raport modelu i trwałości: [DURABILNOSC_2026-10-17.md](DURABILNOSC_2026-10-17.md). Odbiór rzeczywistego Preview i CI: [WERYFIKACJA.md](WERYFIKACJA.md). Bieżący produkcyjny deployment i SHA: [PR #16](https://github.com/HazEOskA/osa-proof/pull/16).

Macierz dotyczy zakresu dowodów z tego PR, nie deklarowanej gotowości wszystkich środowisk. `VERIFIED` zawsze ma podany zakres. Zielony test z symulowanym dostawcą nie dowodzi działania usługi zewnętrznej.

| Warstwa | Status | Dowód i zakres | Ograniczenie / warunek |
|---|---|---|---|
| Agenci i profile floty | PARTIAL | Jeff domyślny, Hermes i pozostałe profile; wybór oraz odtworzenie po odświeżeniu w testach UI 320/390/1440 | Profile rozmowy nie dowodzą autonomicznej pracy ról |
| Team Graph | VERIFIED | `tests/backend.test.ts`, `tests/build-workspace.test.ts`, `tests/mission-kernel.test.ts`: walidacja, zakres, handoff, wersja | Zweryfikowany kontrakt i lokalne wykonanie; nie cała flota cloud |
| Modele NVIDIA | VERIFIED | Rzeczywisty bezpłatny Nemotron na Preview; provider_response_id i execution_id w raporcie trwałości; tool_call uruchomił SHA-256 | Zakres jednego modelu i testu; bez Redis limit pozostaje lokalny |
| OpenRouter / OpenAI / Anthropic / zgodne API | IMPLEMENTED_UNVERIFIED | Istniejące adaptery rozszerzone o zwykły czat i historię; lokalne kontrakty HTTP oraz formularz 320/390/1440 | Nie wykonano rzeczywistego wywołania tych dostawców ani płatnego fallbacku; wymagany własny klucz/model |
| Połączenia i klucze API | VERIFIED | Rzeczywisty szyfrowany Postgres: nowa instancja, odmowa obcego właściciela i odczyt metadanych bez klucza PASS | Zakres zapisu/ochrony, nie generacji innych dostawców; TTL 30 dni, wymagane cookie właściciela i niezmieniony klucz AES |
| Modelowe tool_calls | VERIFIED | Rzeczywista odpowiedź NVIDIA → osa_sha256 → Runtime → oba dowody → receipt; oba verifiery i Replay z Postgresa 320/390/1440 PASS | Jeden odczytowy tool i jeden model; receipt nie jest podpisem wystawionym przez NVIDIA |
| Runtime | VERIFIED | Lokalny SHA-256 przez HTTP i przeglądarkę; testy Runtime oraz Mission Kernel | Dowód dotyczy natywnego wykonawcy, nie modelu i infrastruktury cloud |
| Narzędzia natywne | VERIFIED | SHA-256, odmowa obcego narzędzia, integralność receipt; `tests/unified-runtime.test.ts`, `tests/unified-p0.test.ts` | Ścieżka deterministyczna jest oznaczona osobno; do modelu dopuszczono tylko SHA-256 |
| Zapytaj OSĘ | PARTIAL | Globalny dock, kontekst i przejścia 320/390/1440; `scripts/test-osa-guide-browser.mjs` | Odpowiedź dostawcy w teście jest symulowana; brak live testu przewodnika |
| Native Builder | GATED | Testy podpisanego zatwierdzenia; rzeczywisty build/test Node w sandboxach CI | Nie wykonano płatnego CLI Claude/Codex ani zmian w repo użytkownika; wymagany zatwierdzony runner/model i grant konkretnego wykonania |
| Worker Host | PARTIAL | Rzeczywisty Worker Host HTTP → Docker → Runtime → MissionReceipt w CI; niezależna weryfikacja pobranego dowodu | Host działał na runnerze CI; Vercel nie ma połączenia z wdrożonym hostem operatora |
| Sandbox Docker | VERIFIED | Prawdziwe kontenery, UID 1000, sieć none, odmowa zapisu do /etc, dwie misje, potwierdzony cleanup | Dowód dotyczy runtime CI; nie jest dowodem provisioningu Azure ani obrazu opublikowanego w registry |
| Misje | VERIFIED | Rzeczywisty Mission Kernel → Postgres → nowa instancja → verifyCompletedMission; CAS i integralność PASS | Dotyczy Mission Kernel i zapisanych wykonań Unified; kolejka oraz autonomiczne workery pozostają osobno ograniczone |
| Kolejki i flota | PARTIAL | Lokalne testy lease/fencing/scope w `tests/platform-v05.test.ts` | Brak trwałej kolejki i rzeczywistych autonomicznych workerów cloud |
| Wiedza / pamięć procesu | PARTIAL | `tests/knowledge.test.ts`, wersje i wyszukiwanie lokalne | Pamięć procesu nie jest pamięcią trwałą |
| NeurOSA | GATED | `brain.memory=NONE` na produkcji; istniejący adapter w `packages/adapters/src/brain.ts` | Brak konfiguracji/połączenia na Preview; kompatybilność rzeczywistego upstream niezweryfikowana |
| Web3 | PARTIAL | Polityki odczytu, utrzymanie precyzji kwot i proof w testach lokalnych | RPC w testach kontrolowane; nie zaliczono live blockchain; zapis/podpisywanie pozostaje zablokowane |
| Tracing / Events | VERIFIED | Rzeczywiste lokalne zdarzenia Runtime, spójne execution_id i kolejność | Pełne payloady zdarzeń Unified nie są objęte rootem receipt v2 |
| Evidence / ProofReceipt | VERIFIED | Backendowy verifier, niezależny verifier przeglądarki, testy usuwania i modyfikacji dowodów | Integralność nie potwierdza prawdy dowolnego źródła ani nie stanowi podpisu NVIDIA |
| Replay | VERIFIED | Rzeczywisty modelowy bundle z Postgresa, pusty kontekst przeglądarki 320/390/1440, oba verifiery, ostatnie zdarzenie i odświeżenie PASS | Odtwarzanie zapisanego wyniku, bez ponownego wywołania modelu; pełne payloady Events Unified nie są zapieczętowane |
| Integracje usług | IMPLEMENTED_UNVERIFIED | Adaptery, kontrakty HTTP/SSE i testy odmów | Brak dowodu działania skonfigurowanych usług cloud w tym wydaniu |
| MCP | GATED | Istnieje ograniczony adapter JSON Streamable HTTP; test kontrolowanego serwera | Produktowe API raportuje UNSUPPORTED; brak potwierdzonej integracji live |
| A2A | PLANNED | API raportuje UNSUPPORTED | Brak dowodu i aktywnego protokołu |
| Cloud deploy | GATED | Istniejący AzureContainerAppsProvider i publisher; poprawiony bootstrap; produkcyjne cloud_providers=[] | Brak podłączonego execution hosta, registry/IAM i zatwierdzonego zakresu kosztu dla nowego provisioningu; nie wykonano Azure deploy |
| Regulated | GATED | `tests/layers.test.ts`, backendowy gate | Brak weryfikacji organizacji, afiliacji i entitlementów |
| Dostęp operatora | PARTIAL | Testy podpisu, originu, projektu, wygaśnięcia i odmów w session; open obejmuje teraz NVIDIA bez sesji operatora | Publiczny wspólny panel na życzenie operatora; brak pełnej izolacji użytkowników. Prywatne połączenia API należą do osobnych cookies HttpOnly |
| Wielu użytkowników / IAM | PLANNED | Jawny zakres pojedynczego operatora | Brak OIDC, zarządzania użytkownikami, pełnego RBAC i odwoływania pojedynczych sesji |
| Control plane | PARTIAL | Istniejący wspólny ApiState, polski UI i trwały zapis rdzenia | Kolejki, rejestr workerów, szkic Buildera, polityki i lokalna wiedza pozostają PROCESS_MEMORY; wspólny panel open |
| Trwałość serverless | PARTIAL | Rzeczywisty Postgres: wykonania/dowody/receipts, Mission Kernel i klucze API; nowy proces, instancja API i CAS PASS | Kolejki, szkic Buildera, polityki i część konfiguracji pozostają PROCESS_MEMORY; zwykły czat lokalny |
| Pełny ONE FLOW na Preview | VERIFIED | `exec_2b067264-0faf-4d82-b8a6-89b5e84978ff`: rzeczywisty czat NVIDIA → modelowy SHA-256 → Runtime → Events/Evidence/receipt → niezależna weryfikacja → trwały Replay na 320/390/1440; nieautoryzowany dispatch 403 | Zakres jednego bezpłatnego modelu i odczytowego narzędzia, bez provisioningu cloud i autonomicznych workerów |

Raport wykonanych kontroli i identyfikatory: [WERYFIKACJA.md](WERYFIKACJA.md).
