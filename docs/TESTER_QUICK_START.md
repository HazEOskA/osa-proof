# OSA Proof — szybki start dla testera

Stan dowodów: 30.10.2026. Punkt odniesienia `main`: `64b1bea65f5c8e11c77c00d3f9171970a57f7a03`. Sprawdź SHA badanego środowiska przed testem: `main`, produkcja i chronione preview mogą mieć różne wersje oraz konfiguracje.

## Co można stwierdzić

| Obszar | Stan i granica dowodu |
| --- | --- |
| Runtime, Evidence, ProofReceipt | Repo zawiera lokalne testy misji, zdarzeń i weryfikacji. `fixture` używa kontrolowanych wyników testowych, nie zdalnego workera. |
| NeurOSA | Na odrębnym stagingu zweryfikowano zapis, odczyt w innej sesji oraz ponowny odczyt dokumentów po restarcie. Nie potwierdza to pamięci produkcyjnej. |
| Worker | Zdalny worker staging odczytał metadane publicznego repozytorium; wynik został zapisany do testowej NeurOSA przez lokalne API. Kod znajduje się w [PR #36](https://github.com/HazEOskA/osa-proof/pull/36), nie w `main`. Odczyt metadanych nie jest audytem kodu repozytorium. |
| Czat NVIDIA + pamięć | Kod integracji istnieje; odpowiedź modelu z odzyskaną pamięcią w nowym preview i produkcji nie została potwierdzona w tym cyklu testów. |
| Replay | Zdarzenia, Evidence i Proof można odczytać w lokalnym teście API. Trwały Replay po restarcie aplikacji i pełny przepływ przez interfejs nie zostały potwierdzone. |
| Produkcja | Odbiór pełnego przepływu E2E pozostaje **BLOCKED**. `READY` deploymentu nie oznacza PASS. |

Dowód staging: `execution_id` `exec_d5c9690f-bac7-44a3-959c-186f9f8e34ac`, `run_id` `run_d433dbec3ef8e80427a9ef6c`, 8 zdarzeń, 1 Evidence, werdykt `VERIFIED`; dokument pamięci `fa4c50e1-8ba2-4c23-bb0e-8ba6e7e362c9` został odczytany po restarcie stagingu. Jest to wynik testu z lokalnego API, nie dowód testu UI preview ani produkcji.

## Lokalny start bez kluczy

Wymagane: Node.js 20+, Git i npm. Praca w katalogu lokalnym; nie podłączaj prywatnej pamięci ani sekretów do testu fixture.

```bash
git clone https://github.com/HazEOskA/osa-proof.git
cd osa-proof
git rev-parse HEAD
npm ci
npm test
OSA_EXECUTION_MODE=fixture OSA_AUTH_MODE=open npm start
```

`npm test` buduje kod i uruchamia testy. Ostatnia komenda uruchamia lokalne API na porcie 3000, nie dashboard. W drugim terminalu:

```bash
curl -s http://localhost:3000/build/status
```

Odpowiedź powinna zawierać `mode: "fixture"`. `npm start` sam nie tworzy misji ani ProofReceipt. Tryb `open` jest przeznaczony do lokalnej demonstracji, a nie do udostępniania prywatnych danych.

## Co testować

1. Uruchom lokalny Quick Start; zapisz SHA, wynik testów i liczbę PASS/FAIL/SKIP.
2. Przeprowadź pierwszą misję z instrukcji `/docs/#first-mission` w dokumentacji repo. Zapisz `run_id`, zdarzenia, Evidence, ProofReceipt i wynik weryfikacji. Rozróżnij fixture od rzeczywistego narzędzia.
3. Dla preview i produkcji testuj tylko środowisko wskazane przez właściciela oraz zakres, na który masz dostęp. Nie zapisuj prywatnych danych do stagingu. Nie proś o tokeny, klucze, ciasteczka ani eksport prywatnej pamięci.
4. W osobnych rozmowach sprawdź pamięć, a następnie worker i Replay. Jeżeli dostęp, źródło, eksport lub konfiguracja nie są dostępne, zapisz `BLOCKED` lub `UNKNOWN` zamiast zakładać sukces.

W raporcie podaj środowisko, SHA, `execution_id`, `executor_ref`, rzeczywisty wynik narzędzia, dokument źródłowy, Evidence i werdykt Proof; oddziel wyniki lokalne, staging i produkcyjne. Nie nazywaj odpowiedzi modelu wykonaniem workera ani samego odczytu pamięci dowodem trwałości po restarcie.
