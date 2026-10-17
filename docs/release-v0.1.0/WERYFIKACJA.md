# Weryfikacja kandydata v0.1.0

> **NAJNOWSZY STAN 17.10.2026 (metadane, bez live model):** aktualny `release/osa-proof-v0.1.0@4c375e8058e30b06f178e261ccb32e4bb45f61b2` ma **3/3 CI SUCCESS**: [backend, testy i build](https://github.com/HazEOskA/osa-proof/actions/runs/38985293601), [browser Android/desktop](https://github.com/HazEOskA/osa-proof/actions/runs/38985293682), [Fleet HTTP/SSE](https://github.com/HazEOskA/osa-proof/actions/runs/38985293598). Obecny produkcyjny alias `osa-proof-three.vercel.app` mapuje się na `dpl_B8s5QZV1t5CMfy6qm453rkFMs2Bh` / `4c375e8` / `READY` (produkcja). Oznaczenie `READY` jest **stanem deploymentu**, nie testem HTTP pod tym aliasem ani dowodem wykonania modelu. Poprzednie zdania o produkcji `512a6e1` odnoszą się do dawnych odczytów. Żaden z tych trzech workflowów nie dostarcza rzeczywistego NVIDIA `tool_calls` ani trwałości chmurowej. [Nowy audyt](AUDYT_DODATKOWY_2026-10-17.md).

**Dowody nadal wymagane do v0.1.0:** autoryzowany model z ważnym potwierdzeniem bezpłatności, realny licznik Redis dwóch instancji, modelowy tool call → Runtime → Evidence → ProofReceipt → Replay z nowym `execution_id` oraz trwały odczyt między instancjami. Testy z symulowanym modelem lub samym native SHA-256 **nie** spełniają tego warunku. Przed użyciem prawdziwych danych sprawdź współdzielony charakter `OPEN_PRODUCTION`.


**Stan wydania: BLOCKED.** Poniższe wyniki opisują bazowy audyt kodu `724c078`. Późniejsza korekta usuwa obowiązkowe logowanie panelu w otwartym Preview; nie zmienia historycznych wyników poniżej. Manifest i stare zrzuty granicy operatora dotyczą wcześniejszej polityki. Aktualne wyniki korekty znajdują się w sekcji na końcu dokumentu.

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

## Korekta: Preview bez obowiązkowego logowania

Na życzenie operatora usunięto blokadę całego panelu w otwartym Vercel Preview. Warunki: `VERCEL=1`, `VERCEL_ENV=preview`, `OSA_AUTH_MODE=open`. Produkcja i wywołania modelu zachowują osobną autoryzację. Konfiguracja modelu, zerowy koszt i wspólny limit pozostają bramkami. Ustawienia Vercel SSO nie były zmieniane.

- `npm test`: **236 PASS, 0 FAIL, 3 SKIP z 239**; [pełny log](../evidence/release-v0.1.0/preview-open-npm-test.txt).
- Backend, dashboard i worker host: kompilacja PASS.
- Rzeczywisty lokalny backend z polityką otwartego Preview: brak ekranu logowania, natywne SHA-256, weryfikacja receipt, Replay do końca, odświeżenie i odmowa zmienionego dowodu — PASS na 320/390/1440. [Wyniki](../evidence/release-v0.1.0/preview-open-results.json), [log](../evidence/release-v0.1.0/preview-open-native-browser.txt).
- Test API odrzuca anonimowy model, modelowy dispatch klienta i wykonania Web3; wyjątek Preview nie działa dla produkcji ani nieznanego środowiska.
- Kontrakty floty, przewodnika i chronionego dostępu: [PASS](../evidence/release-v0.1.0/preview-open-ui-contracts.txt); transport modelu i auth w tych kontraktach pozostają symulowane.

| Widok | execution_id | Natywny bundle |
|---|---|---|
| android-320 | `exec_c519f688-a55c-4f29-9b35-f5d925a7e4ac` | [dowód](../evidence/release-v0.1.0/preview-open-android-320-bundle.json) |
| android-390 | `exec_7ffbaff5-c91e-4812-b12c-8d0500a6f53e` | [dowód](../evidence/release-v0.1.0/preview-open-android-390-bundle.json) |
| desktop | `exec_6927de50-2ced-436b-97c1-13784263530b` | [dowód](../evidence/release-v0.1.0/preview-open-desktop-bundle.json) |

Bieżący commit, CI i odczyt wdrożonego Preview są powiązane w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). Nie wykonano płatnego testu modelu ani wdrożenia produkcyjnego. Stan wydania pozostaje BLOCKED.

## Produkcyjny tryb open na polecenie operatora

Po korekcie Preview operator osobno zlecił wdrożenie gałęzi na produkcję, aby sprawdzić panel pod stałym adresem. Dopuszczony open obejmuje teraz jawne Vercel Preview i produkcję. Tryb session, autoryzacja wywołań modelu, koszty i blokady narzędzi mutujących pozostają aktywne. Wcześniejsze deklaracje o niezmienionej produkcji opisują poprzedni checkpoint.

Pełne npm test: **237 PASS, 0 FAIL, 3 SKIP z 240**; [log](../evidence/release-v0.1.0/production-open-npm-test.txt). Build backendu, dashboardu i worker hosta PASS. Prawdziwy lokalny backend z produkcyjną polityką open przeszedł browser E2E na 320/390/1440: brak logowania, natywny SHA-256, receipt, Replay, odświeżenie i odmowa zmienionego bundle. [Wyniki](../evidence/release-v0.1.0/production-open-results.json), [log](../evidence/release-v0.1.0/production-open-browser.txt).

- android-320: `exec_5831b75c-e1aa-4362-80d7-37b1c3d48433`, [bundle](../evidence/release-v0.1.0/production-open-android-320-bundle.json).
- android-390: `exec_de3aafb9-a3e3-49d7-a344-ac07bcd90965`, [bundle](../evidence/release-v0.1.0/production-open-android-390-bundle.json).
- desktop: `exec_af0ce349-a259-413f-92db-7746f493503b`, [bundle](../evidence/release-v0.1.0/production-open-desktop-bundle.json).

Bieżący commit, CI, deployment i odbiór rzeczywistej produkcji są wskazane w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). To testy natywnego Runtime; nie zaliczają modelowego E2E ani formalnego wydania. [Zakres wdrożenia i rollback](WDROZENIE_PRODUKCJA.md).

## Nowszy odbiór runtime i produkcji

Zaliczono dwa rzeczywiste wykonania Docker/Worker Host w CI, pobrano artefakty i niezależnie zweryfikowano oba receipts. Publiczny natywny przepływ produkcyjny przeszedł 320/390/1440; model i Azure nie zostały zastąpione mockiem jako dowodem działania. Identyfikatory, linki do CI, hash archiwum i faktyczne pozostałe warunki: [DOMKNIECIE_RUNTIME_2026-10-17.md](DOMKNIECIE_RUNTIME_2026-10-17.md).
