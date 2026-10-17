# Weryfikacja kandydata v0.1.0 — 17.10.2026

Status formalnego wydania: **BLOCKED** przez brak podłączenia istniejącego Worker Hosta do Vercel. Modelowy ONE FLOW i trwały rdzeń są już rzeczywiście potwierdzone. Nie utworzono tagu ani GitHub Release. Bieżący head, alias produkcji i końcowe CI: [PR #16](https://github.com/HazEOskA/osa-proof/pull/16).

## Kod i CI

Odbiór dotyczy kodu `3f6ada3d99b8224e80506eca1020eb941455c424`, tree `3a2a3d38c1e993cc55869177385b4f389692f0af`. Lokalnie przetestowane drzewo i drzewo GitHub były identyczne przed aktualizacją gałęzi. Kolejny checkpoint dodaje skrypt odbioru, dokumentację i dowody; nie zmienia kodu aplikacji.

| Kontrola | Rzeczywisty wynik |
|---|---|
| Pełne npm test, backend | 254 łącznie: 250 PASS, 0 FAIL, 4 SKIP; [zestawienie](../evidence/release-v0.1.0/finalization-three/tests.txt) |
| Worker Host i dashboard | Lokalne buildy PASS; również [CI testów i rzeczywistego Docker](https://github.com/HazEOskA/osa-proof/actions/runs/39032280743) SUCCESS |
| UI i lokalny Runtime 320/390/1440 | [CI Android/desktop](https://github.com/HazEOskA/osa-proof/actions/runs/39032280787) SUCCESS; [kontrakty](../evidence/release-v0.1.0/finalization-three/ui-contracts.txt), [natywny browser](../evidence/release-v0.1.0/finalization-three/native-browser.txt) |
| Fleet HTTP/SSE | [CI](https://github.com/HazEOskA/osa-proof/actions/runs/39032280744) SUCCESS; kontrakty bez rzeczywistego zewnętrznego dostawcy |
| Rzeczywisty model i narzędzie | Dwa żądania bezpłatnego NVIDIA na Preview; szczegóły poniżej |
| Postgres | [Rzeczywiste testy](../evidence/release-v0.1.0/finalization-three/durable-live-results.json): nowy proces/instancja API, misja, CAS, szyfrowanie, odmowy podpisu/właściciela/namespace |
| Formularz API na Preview | [PASS](../evidence/release-v0.1.0/finalization-three/preview-connections.json): rzeczywisty zapis/odczyt/usunięcie w Postgresie, nowy kontekst z cookie właściciela, odmowa obcego ownera/originu, bez klucza w odpowiedzi/frontend storage; losowy znacznik, 0 generacji |
| Nieautoryzowany dispatch narzędzia | [HTTP 403](../evidence/release-v0.1.0/finalization-three/preview-negative.json), bez wywołania modelu |
| Niezależna weryfikacja i zmiana dowodu | Oba verifiery PASS dla prawdziwego bundle; zmieniony materiał odrzucony |

## Prawdziwy ONE FLOW w przeglądarce

Preview: [osa-proof-e0up3e3ey](https://osa-proof-e0up3e3ey-osabarca-1680s-projects.vercel.app), deployment `dpl_4pmdCrod3ZVnLqDV49FuPQjpfuHE`, SHA `3f6ada3d99b8224e80506eca1020eb941455c424`. Bezpłatność dokładnego modelu i tool calling były sprawdzone w [oficjalnym katalogu NVIDIA](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b).

Czat floty agentów na emulowanym Androidzie 390 px wysłał jedno rzeczywiste żądanie do serwerowego NVIDIA. Model zwrócił `osa_sha256` z argumentem `text="OSA Proof v0.1.0"`; Runtime wykonał SHA-256, zapisał dwa materiały dowodowe i receipt oraz utrwalił bundle w Postgresie przed odpowiedzią sukcesu.

| Pole | Wartość |
|---|---|
| execution_id | `exec_2b067264-0faf-4d82-b8a6-89b5e84978ff` |
| model żądany i raportowany | `nvidia/nemotron-3-super-120b-a12b` |
| provider_response_id | `chatcmpl-2f3d5879-ec5e-4bec-9698-107de1080a8b` |
| tool_call | `call-7e87cb2f-9c2a-4c44-92f5-c34d9a415440`, `osa_sha256` |
| routing / zdarzenia | `MODEL_TOOL_CALL`, 9, jeden execution_id |
| run_id | `run_7f583a7eb1a9365ae83172b1` |
| proof_id | `proof_b18179c70cac944e769fca3248f20809fa0893ed44c7e3b380140e5e2a5ec4df` |
| niezależnie obliczony SHA-256 | `6b3754309dea732d2b0afbdcfe7dbc1c2be5e31d881db6c70773257488b1145d` |

[Pełna odpowiedź modelu i bundle](../evidence/release-v0.1.0/finalization-three/nvidia-preview-attempt-2.json), [wyniki browser](../evidence/release-v0.1.0/finalization-three/model-browser-results.json), [skrypt](../../scripts/test-model-preview-live.cjs). Skrypt nie ma podmiany sieci, route.fulfill ani retry; znacznik próby zapobiega jego przypadkowemu ponowieniu w tym odbiorze. Limit odbioru wynosił dwa żądania łącznie, oba bezpłatne; żadne kolejne generacje nie były potrzebne do Replay.

| Odtwarzanie | Pusty kontekst | Odczyt z Postgresa | Niezależny verifier WebCrypto | Replay do końca | Odświeżenie | Nowe żądania modelu |
|---|---|---|---|---|---|---|
| Android 320 px | PASS | PASS | PASS | PASS | PASS | 0 |
| Android 390 px | PASS | PASS | PASS | PASS | PASS | 0 |
| Desktop 1440 px | PASS | PASS | PASS | PASS | PASS | 0 |

Zrzuty: [czat 390](../evidence/release-v0.1.0/finalization-three/model-chat-390.png), [Replay 320](../evidence/release-v0.1.0/finalization-three/model-replay-320.png), [Replay 390](../evidence/release-v0.1.0/finalization-three/model-replay-390.png), [Replay desktop](../evidence/release-v0.1.0/finalization-three/model-replay-1440.png). Android był emulowany przez Chromium, nie sprawdzany na fizycznym urządzeniu.

Pierwszy test HTTP: `exec_b2457490-e018-4a09-9de9-4cfefaf072cf`, odpowiedź `chatcmpl-c093039d-48e3-4762-8336-f02b24d5214d`, ten sam model i argumenty. [Weryfikacja](../evidence/release-v0.1.0/finalization-three/independent-model-verification.json). Ten bundle był później czytany z nowego procesu i instancji API, bez ponownej generacji.

## Granice dowodów i pozostałe warunki

Receipt wiąże wynik, materiał model_dispatch i dowody Runtime; nie jest podpisem NVIDIA. Unified v2 nie zapieczętowuje pełnych payloadów każdego zdarzenia. Replay odtwarza zapisany wynik, a nie ponownie model. Rzeczywiste OpenAI/Anthropic/OpenRouter nie były wywoływane, a ich kontrolowane testy nie są live PASS.

Trwałość dotyczy Unified/Evidence/receipts/Mission Kernel/połączeń, nie wszystkich modułów. Kolejki, rejestr workerów, szkic Buildera, polityki i lokalna wiedza pozostają PROCESS_MEMORY. Historia zwykłego czatu pozostaje lokalna. Plan Free może wstrzymać nieaktywny projekt; nie skonfigurowano płatnego SLA ani płatnej bazy.

Publiczny open pozostaje decyzją operatora; prywatne połączenia są oddzielone przez cookies, ale wspólny panel nie jest prywatnym IAM. Bez Redis limit modelu pozostaje lokalny dla instancji. Nie usunięto kontroli mutujących narzędzi.

Rzeczywisty Docker w CI nie dowodzi podłączenia operatorowego hosta. Brak `OSA_WORKER_BASE_URL` i `OSA_WORKER_TOKEN` na Vercel uniemożliwia końcowy odbiór istniejącego cloud/Buildera. Azure deploy tworzy płatne zasoby i nie był uruchamiany przy budżecie 0. NeurOSA i funkcje roadmap zachowują statusy z [MACIERZ.md](MACIERZ.md).
