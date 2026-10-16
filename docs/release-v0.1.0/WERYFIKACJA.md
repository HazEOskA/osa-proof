# Weryfikacja kandydata v0.1.0

**Stan wydania: BLOCKED.** Poniższe wyniki dotyczą lokalnego drzewa kodu i jawnie określonych kontraktów.

| Kontrola | Wynik | Dowód |
|---|---|---|
| Pełne npm test / backend | 234 PASS, 0 FAIL, 3 SKIP z 237 | [log](../evidence/release-v0.1.0/npm-test.txt) |
| Dashboard TypeScript + Vite | PASS | [log](../evidence/release-v0.1.0/dashboard-build.txt) |
| Worker host TypeScript | PASS, bez testu prawdziwej izolacji | [log](../evidence/release-v0.1.0/worker-build.txt) |
| UI floty, przewodnik i granica operatora | PASS na 320/390/1440; transport AI i odpowiedź auth symulowane | [log](../evidence/release-v0.1.0/ui-contracts.txt) |
| Natywny Runtime → receipt → Replay do ostatniego zdarzenia | PASS na 320/390/1440 | [log](../evidence/release-v0.1.0/native-browser.txt) |
| Odświeżenie i odmowa zmienionego bundle | PASS, wyłącznie zapis lokalny | [wyniki](../evidence/release-v0.1.0/results.json) |
| Rzeczywiste NVIDIA tool_calls na Preview | BLOCKED / NOT_TESTED | Brak warunków uruchomienia; nie zastąpiono mockiem |
| Wspólny licznik na prawdziwym Redis | NOT_TESTED | Testy transportu są symulowane; brak skonfigurowanej usługi |
| Trwałość cloud | BLOCKED | PROCESS_MEMORY; [odczyt środowiska](../evidence/release-v0.1.0/environment-readonly.json) |
| Znane formaty sekretów w zmianach | PASS; kontrola ograniczona do wzorców i przeglądu diffu | [wynik](../evidence/release-v0.1.0/diff-secret-formats.json) |

Na szerokościach 320 i 390 użyto emulacji Androida (profil Pixel 7, mobile/touch), na 1440 — Chromium desktop. Nie jest to test fizycznego telefonu. Chromium 153.0.8010.0 / Playwright 1.63.0.

Pominięte testy live: rzeczywisty provider LLM, zewnętrzna usługa Fleet i pełne wykonanie w Docker. Nie zaliczono ich jako PASS. Nie uruchomiono modeli zewnętrznych, płatnego provisioningu ani produkcyjnego deployu.

## Rzeczywiste lokalne wykonania natywne

| Widok | execution_id | Bundle |
|---|---|---|
| android-320 | `exec_747445b6-e172-4df5-807b-9d7e78cd3db8` | [dowód](../evidence/release-v0.1.0/android-320-bundle.json) |
| android-390 | `exec_3fffac2f-3a8d-46d0-9fae-4bc74abcd4de` | [dowód](../evidence/release-v0.1.0/android-390-bundle.json) |
| desktop | `exec_67274aa8-da5b-450e-b201-ecb663a89100` | [dowód](../evidence/release-v0.1.0/desktop-bundle.json) |

Bundle są ponownie sprawdzane przez backendowy verifyUnifiedBundle i niezależny verifier przeglądarki. Pochodzą z prawdziwego natywnego SHA-256, **nie z modelu NVIDIA**. Ich integralność nie jest poświadczeniem dostawcy.

## Zrzuty

- [Android 320 — wykonanie natywne](../evidence/release-v0.1.0/android-320-chat.png) i [Replay](../evidence/release-v0.1.0/android-320-replay.png).
- [Android 390 — wykonanie natywne](../evidence/release-v0.1.0/android-390-chat.png) i [Replay](../evidence/release-v0.1.0/android-390-replay.png).
- [Desktop — Replay](../evidence/release-v0.1.0/desktop-replay.png).
- [Przewodnik 320 — kontrakt z symulowanym modelem](../evidence/release-v0.1.0/guide-telefon-320.png).
- [Zablokowany dostęp operatora 320 — kontrakt UI](../evidence/release-v0.1.0/operator-blocked-320.png).

## Powiązanie kodu i CI

Manifest źródeł: `1d3c5cf4ab25c50b68257c917915c300f07976a207d92cb17e66be77171c5e0f` ([pliki i skróty](../evidence/release-v0.1.0/source-manifest.json)). Weryfikowane źródła obejmują kod, testy, konfigurację i workflow; dokumentacja nie jest częścią tego skrótu.

Kod opublikowano w commicie `724c078cd9a7bec0206021646351f2fdb42418ff`; jego tree `d9d0c5b026d5057b85afabe0b80cdeb44b0beaaa` jest identyczne z lokalnie przetestowanym drzewem. PR wydawniczy: [#16](https://github.com/HazEOskA/osa-proof/pull/16). Kolejny commit uzupełnia wyłącznie dokumentację i dowody.

| CI kodu 724c078 | Wynik |
|---|---|
| [Testy, backend, worker, dashboard i kontrola diffu](https://github.com/HazEOskA/osa-proof/actions/runs/38980249753) | PASS |
| [Przeglądarka Android/desktop, przewodnik, izolacja historii, receipt i Replay](https://github.com/HazEOskA/osa-proof/actions/runs/38980249823) | PASS |
| [Kontrakty Fleet HTTP/SSE bez modelu](https://github.com/HazEOskA/osa-proof/actions/runs/38980249810) | PASS |

Nowe [Preview](https://osa-proof-fesbid6j8-osabarca-1680s-projects.vercel.app), deployment `dpl_BeWxx5Zjwn2ThJGLnE5TzqCWxpC4`, commit `724c078`, jest READY. Rzeczywisty GET przez Vercel MCP potwierdził `/api/auth/access` → `required=true`, `configured=false`, `authenticated=false`, a `/api/nvidia/status` i `/api/build/status` → **503 OPERATOR_ACCESS_NOT_CONFIGURED**. To działająca blokada braku konfiguracji, nie awaria modelu i nie pełny E2E.

Publiczny, anonimowy POST do narzędzia SHA-256 na tym Preview otrzymał **401**, bez wywołania trasy modelu. Sam ten wynik nie rozstrzyga warstwy odmowy; aplikacyjny gate potwierdzają osobne odczyty powyżej. [Surowe wyniki](../evidence/release-v0.1.0/cloud-preview-boundary.json).

Produkcja pozostaje READY na `512a6e1` / `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ`; nie zmieniono jej konfiguracji, ochrony ani deploymentu. Pełna ścieżka NVIDIA i trwałość serverless nadal są BLOCKED.

Zakres Security Gate: przegląd źródeł i regresje API, sesji, kosztów, sekretów oraz uprawnień narzędzi. Nie jest to deklaracja pełnego audytu penetracyjnego ani raportu z formalnego skanera Codex Security.
