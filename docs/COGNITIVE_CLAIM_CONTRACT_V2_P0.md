# OSA Proof — Architecture Lock v2 / P0

## GOAL
Uniwersalna obsługa dowolnych pytań bez blokowania zwykłych rozmów przez parser e-commerce. Osobna weryfikacja wykonania (APR) i treści (claims), bez fałszywego potwierdzania faktów.

## Wdrożenie P0
- `apps/api/src/nvidia.ts` nie importuje ani nie uruchamia `checkCommerceArithmetic`. Zwykły czat nie jest blokowany przez parser tekstu lub nieznany format wyniku; kontrola APR nadal może zatrzymać niepoprawne wykonanie.
- Specjalistyczny `apps/api/src/commerce-arithmetic-gate.ts` pozostaje dostępny dla jawnie dobranych, przyszłych narzędzi. Nie jest globalnym strażnikiem NVIDIA.
- **Druga ochrona przed globalnym false positive:** APR nadal zbiera i zapisuje obserwacje starej heurystyki atrybucji pogody/kursów (`claim_attribution`), ale dla zwykłej rozmowy używa host-only `claim_enforcement=REPORT_ONLY`. Sam `CLAIM_UNSUPPORTED` nie unieważnia już poprawnego technicznie wykonania czatu. Inne misje, narzędzia i artefakty pozostają w domyślnym `ENFORCE` — bez zmiany polityki przyjmowania narzędzi.
- `packages/proof-core/src/claim-verification.ts` wprowadza `osa.claim_verification.v2`: twierdzenie, SHA-256 treści, weryfikator, dowód związany z wykonaniem, wynik `SUPPORTED | CONTRADICTED | UNKNOWN`. Kontrakt nie zawiera słów kluczowych żadnej dziedziny.
- `apps/api/src/chat-assurance.ts` zwraca `osa.chat_content_assurance.v2` i zachowuje `execution_verdict` niezależnie od `verdict` treści.
- Cytowane dowody muszą znajdować się w przekazanym zestawie referencji zweryfikowanego wykonania; dodatkowo identyfikator weryfikatora musi być zaufany po stronie hosta. Nie wolno budować allowlisty z danych od użytkownika, promptu, modelu lub dokumentów.
- Zwykły czat w P0 nie posiada niezależnego ekstraktora twierdzeń ani weryfikatora ich treści. Przekazuje puste zestawy kandydatów/ustaleń/allowlistę — wynik `UNKNOWN`, zakres `NONE`. **Nie ogłaszamy, że P0 rozwiązuje halucynacje.**
- Gdy pojawią się niezależnie sprawdzone ustalenia, kontrakt może oceniać jawnie wskazane twierdzenia. `SUPPORTED` nie oznacza prawdziwości całej wypowiedzi, dopóki zaufany ekstraktor nie potwierdzi pełnego pokrycia.
- Przy sprzecznych ustaleniach: `UNKNOWN` z kodem `CONFLICTING_EVIDENCE`; brak dowodów: `UNKNOWN`. Niepewność nie jest naruszeniem polityki ani automatyczną przyczyną `BLOCKED`.
- Planowanie Brain, MissionKernel, Runtime, istniejąca weryfikacja APR i eksport bundle pozostają zachowane. `chat_audit.v1` zawiera `content_assurance.v2`, `proof`, SHA-256 odpowiedzi, zakres pamięci i dane wykonania.
- Nie zmieniono routingu OAuth, konfiguracji domeny, adapterów NeurOSA ani produkcji. Żadnego nowego sekretu, hosta ani deployu.

## Granice dowodowe
- SHA-256 oraz powiązanie z `evidence_refs` potwierdza integralność referencji, **nie autentyczność nadawcy ani prawdziwość informacji**.
- Dopuszczony identyfikator weryfikatora pochodzi z zaufanego kodu hosta. Obecne P0 nie podłącza rzeczywistego niezależnego weryfikatora treści — pusta allowlista jest zamierzona.
- Wykonanie `APR VERIFIED` pozostaje ograniczone do wymagań misji (np. kompletna odpowiedź modelu); nie jest certyfikatem prawdziwości ani aktualności twierdzeń.
- P0 nie tworzy automatycznego identyfikatora źródła dla wszystkich faktów, nie zapewnia semantycznego fact-checkingu ani gwarancji całkowitej poprawności.
- Test E2E na produkcyjnej sesji OAuth/NeurOSA wymaga osobnego zatwierdzenia merge. Preview jest ograniczone.

## GO / NO-GO na merge
1. Pełne `npm test`, `npm run build` i dashboard build PASS.
2. SSE: zarówno poprawny tekst ze znakiem minus `–`, jak i błędna arytmetyka nie są odrzucane przez globalny Commerce Gate; obie odpowiedzi mają jawne `UNKNOWN`, nigdy `CONTENT_VERIFIED`.
3. Powiązane z wykonaniem niezależne ustalenia dają `SUPPORTED` / `CONTRADICTED`; bez nich `UNKNOWN`. Nieautoryzowane i obce referencje są odrzucane.
   Dodatkowo odpowiedź zawierająca heurystycznie wykryte twierdzenie pogodowe bez źródła nie jest blokowana w zwykłym czacie, ale musi zachować `claim_attribution` i `claim_enforcement=REPORT_ONLY` w ProofReceipt. Domyślne kontrolowane misje nadal `ENFORCE`.
4. Brain/Runtime/APR, scope tenant, OAuth, NeurOSA, browser/mobile i eksport bundle bez regresji.
5. Draft PR; brak merge, brak produkcyjnych zmian.

## P1 poza zakresem
Ekstrakcja kandydatów twierdzeń, realny niezależny weryfikator źródeł oraz dobór narzędzi przez Cognitive Layer zależny od rodzaju pytania. Projektowanie i wdrożenie P1 wymaga nowego scope i zgody.
