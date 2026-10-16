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

Wyniki GitHub Actions oraz stan nowego Preview zostaną dopisane po wypchnięciu gałęzi wydawniczej. Nie uznano starego CI z innego commitu za dowód tego kandydata.

Zakres Security Gate: przegląd źródeł i regresje API, sesji, kosztów, sekretów oraz uprawnień narzędzi. Nie jest to deklaracja pełnego audytu penetracyjnego ani raportu z formalnego skanera Codex Security.
