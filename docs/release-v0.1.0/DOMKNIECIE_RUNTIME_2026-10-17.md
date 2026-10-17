# Odbiór runtime, sandboxów i produkcji — 17.10.2026

**Stan formalnego wydania: BLOCKED.** Kod naszego cloud, sandboxów i workera istnieje i został użyty. Nie utworzono drugiego frameworka, control plane ani repozytorium.

## Wykonane naprawy i wdrożenie

- Bootstrap workera zapisuje organizację i projekt wymagane przez Compose; brak scope zatrzymuje start przed instalacją pakietów. Zachowuje token przy ponowieniu, tworzy prywatny plik env i nie wykonuje jego treści.
- Worker/Azure bootstrap domyślnie pobierają aktualną gałąź wydawniczą. Nowy sandbox ma sieć none. Azure skrypt nie rotuje istniejącego sekretu podczas zwykłego redeployu.
- Rozwiązano konflikt README z main w gałęzi wydawniczej, zachowując kanoniczny opis OSA. Przywróciło to uruchamianie CI PR #16. Nie scalono PR do main.
- Wdrożony checkpoint kodu: `5f2c2ac709d0463673953c4b98c31814c164b0cf`; produkcja `dpl_EstcQjvo6VGJPdBxcVafphuzM6dk`, READY, target production, https://osa-proof-three.vercel.app. Późniejsza poprawka paska przycisków na 320 px i dokumentacja znajdują się w tym samym PR #16; jego opis wiąże końcowy head i wdrożenie.

## Rzeczywiste wykonanie Docker / Worker Host

CI kodu: **3/3 PASS** — [testy, Docker i buildy](https://github.com/HazEOskA/osa-proof/actions/runs/39000369616), [Android/desktop i Replay](https://github.com/HazEOskA/osa-proof/actions/runs/39000369560), [Fleet HTTP/SSE](https://github.com/HazEOskA/osa-proof/actions/runs/39000369580). Pełne npm test: 240 PASS / 0 FAIL / 4 SKIP z 244. Osobny obowiązkowy krok LIVE Docker: **2 PASS / 0 FAIL**. To standardowy runner CI; nie provisionowano nowej VM.

1. Fleet → dwa rzeczywiste sandboxy → source handoff → build/test Node → sealed proof: `exec_3facbc2a-b243-45a5-ac11-908437064865`; [misja](../evidence/release-v0.1.0/worker-docker-ci/mission.json).
2. Worker Host HTTP → RemoteWorkspaceProvider → prawdziwy Docker → Runtime → receipt → cleanup: `exec_5f242576-63bb-4a26-b79c-456674a0b61e`; [misja](../evidence/release-v0.1.0/worker-docker-ci/worker-mission.json), [wynik](../evidence/release-v0.1.0/worker-docker-ci/worker-result.json).

Weryfikowane są UID 1000, sieć none, odmowa zapisu do /etc, odmowa braku tokenu i obcego scope oraz usunięcie kontenera. Archiwum artefaktu CI `12088931300` ma SHA-256 `36ffbd9a7d51bb5399ef2cd34563e4f771104fa123e7790501d99114ca7f0528`. Po pobraniu sprawdzono hash i ponownie wykonano verifyCompletedMission dla obu zapisów poza CI: [niezależny wynik](../evidence/release-v0.1.0/worker-docker-ci/independent-verification.json). To dowód runtime i transportu workera, nie wywołania modelu ani Azure.

## Publiczna aplikacja

Prawdziwe HTTPS do stałego adresu produkcji, bez zastępowania odpowiedzi API: natywne SHA-256 → Evidence → ProofReceipt → niezależna weryfikacja → Replay do końca → odświeżenie → odmowa zmodyfikowanego bundle. PASS w emulacji Android 320/390 i desktop 1440: [wyniki](../evidence/release-v0.1.0/production-live/results.json).

- Android 320: `exec_2f24ea5d-7c6e-4673-9f8a-de7123303902`, [bundle](../evidence/release-v0.1.0/production-live/android-320-bundle.json).
- Android 390: `exec_ca148e0c-843f-400e-b832-9498f8f74481`, [bundle](../evidence/release-v0.1.0/production-live/android-390-bundle.json).
- Desktop: `exec_613830a7-755d-42f1-a3a7-1b36cb25d148`, [bundle](../evidence/release-v0.1.0/production-live/desktop-bundle.json).

Test przeglądarki użył wymaganego proxy runtime i lokalnego wyjątku CA wyłącznie w świeżym kontekście testowym. Nie zmieniono TLS produkcji. HTTPS API sprawdzono też zwykłym urllib z systemowym CA. Nie zaliczamy tego browser testu jako audytu TLS: [warunki testu](../evidence/release-v0.1.0/production-live/browser-environment.json).

Anonimowe POST obu endpointów modelu odrzucono **401 MODEL_OPERATOR_SESSION_REQUIRED**, bez wysłanego promptu i credentials: [odmowy](../evidence/release-v0.1.0/production-live/model-auth-negative.json). [Odczyt API](../evidence/release-v0.1.0/production-live/read-only-status.json): OPEN_PRODUCTION, PROCESS_MEMORY, brain.memory=NONE, cloud_providers=[], deployment_execution_enabled=false, NVIDIA available=false / NVIDIA_COST_POLICY_BLOCKED.

Odbiór zrzutu ujawnił przycięty przycisk Wyślij na 320 px. Poprawiono zawijanie istniejącego paska, dodano asercję położenia przycisku przed wysłaniem i zaliczono lokalny browser E2E na 320/390/1440. UI zachowuje istniejący styl, moduły i nawigację.

## Pozostałe rzeczywiste warunki

**Pierwszy warunek podłączenia własnego execution plane:** adres działającego Worker Hosta i jego bezpieczne credentials. Vercel ma klucz NVIDIA, ale nie ma OSA_WORKER_BASE_URL ani OSA_WORKER_TOKEN; nie ma też konfiguracji Azure, trwałego backendu ani NeurOSA. Nie oznacza to, że host nie istnieje — jego tożsamość i dostęp nie zostały udostępnione tej sesji.

Po wskazaniu istniejącego hosta należy skonfigurować jego URL/token i zgodny scope po stronie serwera oraz powtórzyć próbę sandboxa na tym hoście. Token należy ustawić w bezpiecznym panelu środowiska; nie wklejać do czatu. Nowy provisioning wymaga konkretnego celu i zaakceptowanego kosztu; nie zastąpiono brakującego hosta płatną usługą.

Dodatkowo pozostają: operator/modelowa autoryzacja, potwierdzenie bezpłatnego konta/modelu i wspólny limit dla NVIDIA; rzeczywiste modelowe tool_calls; istniejący registry/IAM/target dla cloud deploymentu; trwały backend zamiast PROCESS_MEMORY; zgodne podłączenie NeurOSA bez prywatnego importu. Istniejące adaptery nie są oznaczane jako działająca usługa na podstawie nazwy ani testu mocka.

Rollback bieżącej publikacji panelu: poprzedni działający produkcyjny deployment `dpl_B8s5QZV1t5CMfy6qm453rkFMs2Bh` / `4c375e8`. Worker host nie został zmieniony ani provisionowany; nowe skrypty i CI można cofnąć commitem odwracającym. Nie wykonano migracji bazy, zmiany sekretów, merge PR, tagu ani GitHub Release.
