# OSA Proof

**Jeden framework do budowania, uruchamiania, obserwacji i weryfikacji systemów agentowych AI.**

> **CLAIM ≠ PROOF** — model może zadeklarować sukces, ale o wyniku decydują zdarzenia wykonania, dowody i niezależna weryfikacja ProofReceipt.

**Aktualny status:** kandydat `v0.1.0` — **BLOCKED**, bez tagu i GitHub Release. [PR wydawniczy #16](https://github.com/HazEOskA/osa-proof/pull/16) jest otwarty jako DRAFT. Kod jest wdrożony również pod produkcyjnym adresem odbioru `https://osa-proof-three.vercel.app` (odczyt 17.10.2026: `4c375e8`, `READY`), ale **to nie jest formalnie wydane v0.1.0** i nie potwierdza modelowego end-to-end ani trwałości serverless.

[Dokumentacja PL — indeks](docs/README.md) · [Bramki wydania](docs/release-v0.1.0/BRAMKI.md) · [Macierz funkcji](docs/release-v0.1.0/MACIERZ.md) · [Dodatkowy audyt](docs/release-v0.1.0/AUDYT_DODATKOWY_2026-10-17.md) · [Dowody i testy](docs/release-v0.1.0/WERYFIKACJA.md)

## Co tworzy OSA Proof

```text
Polski interfejs / API / agenci
  → Team Graph (wersjonowany graf zespołu)
  → Misja / Mission Kernel
  → OsaRuntime / autoryzowany executor
  → Tracing i zdarzenia
  → Evidence i ProofReceipt
  → niezależna weryfikacja / Replay
```

OSA Proof pozostaje **jednym produktem i jedną kanoniczną warstwą proof**. Istniejące adaptery NVIDIA, innych providerów, Build, Workera, NeurOSA, Fleet i Web3 współpracują z tym core; nie tworzą drugiego control plane.

### Moduły aplikacji

| Moduł | Co udostępnia | Granica bieżącego wydania |
| --- | --- | --- |
| Budowanie | Agenci, Team Graph, przepływy, narzędzia, prompty, Studio, plac testowy | Konfiguracja grafu nie dowodzi uruchomionego workera |
| Czat floty agentów | Natychmiastowe odpowiedzi NVIDIA, profil rozmowy i oddzielny tryb narzędzi | Prawdziwe modelowe `tool_calls` w chmurze nadal wymagają odbioru |
| Zapytaj OSĘ | Globalny kontekstowy samouczek i przejścia między ekranami | Pomaga nawigować, sam nie wykonuje operacji |
| Misje i Runtime | Rejestracja, planowanie, wykonanie, policy gate | Część stanu na Vercel istnieje tylko w pamięci procesu |
| Śledzenie, Dowody, Replay | Weryfikacja integralności receipt i odtwarzanie dostępnego bundle | Odtwarzanie nie uruchamia agentów ponownie; nie jest zewnętrzną atestacją providera |
| Builder / Workery | Native Builder i adapter izolowanego workspace | W chmurze `GATED` bez rzeczywistego hosta i zgody operatora |
| Inteligencja / Memory | Modele, wiedza, dane, ewaluatory, opcjonalna NeurOSA | Memory live oraz część integracji wymagają konfiguracji i testów |
| Web3 / Regulated | Polityki odczytu i bramki regulowane | Brak zgody na podpisywanie/wykonywanie transakcji i niezweryfikowane uprawnienia |

Dokładny, aktualny status każdego obszaru: [MACIERZ.md](docs/release-v0.1.0/MACIERZ.md). W menu istnieją także sekcje planowane — **nie** oznacza to ich aktywnej implementacji.

### Trzy warstwy produktu

- **OSA Academy / SCHOOL:** edukacja na tym samym core, z ograniczonym zestawem możliwości.
- **OSA Builder / DEV:** główna warstwa grafów agentowych, modeli, wykonania, obserwowalności, dowodów i adapterów.
- **OSA Regulated:** kontrolowane wejścia dla branż regulowanych; bez weryfikacji uprawnień funkcje pozostają zamknięte.

Kontrakt produktu: [PRODUCT_CONTRACT.md](docs/PRODUCT_CONTRACT.md), [LAYER_BOUNDARIES.md](docs/LAYER_BOUNDARIES.md).

## Uruchomienie lokalne (offline, bez kosztów modelu)

Wymagany Node.js `>=20` oraz npm. Dla zgodności z CI zalecana jest wersja Node.js 24.

```bash
npm ci
npm test
npm run worker:build
node scripts/build-dashboard.cjs
OSA_EXECUTION_MODE=fixture OSA_AUTH_MODE=open npm start
```

- `fixture` jest świadomie **trybem testowym**, a nie dowodem wykonania przez komercyjny model.
- `OSA_EXECUTION_MODE` musi być jawnie wskazany (`fixture` lub `provider`).
- `npm test` obejmuje kontrakty i regresje; nie zastępuje rzeczywistych testów usług zewnętrznych.
- W trybie lokalnego developmentu otwarty `OSA_AUTH_MODE=open` jest odpowiedni wyłącznie dla zaufanego środowiska.
- Przykładowy provider w natywnym `provider` executorze jest konfigurowany oddzielnie od czatu NVIDIA przez `OSA_PROVIDER`, `OSA_MODEL` i właściwy sekret dostawcy. Zobacz [INTELLIGENCE_LAYER_V1.md](docs/INTELLIGENCE_LAYER_V1.md).

## Bezpieczeństwo Preview i Production

**Uwaga: odbiór pod publicznym adresem nie oznacza bezpiecznej produkcji dla prywatnych danych.**

- `VERCEL=1`, `VERCEL_ENV=preview|production` i `OSA_AUTH_MODE=open` pozwalają korzystać z panelu demo bez logowania. Część API korzysta ze **wspólnego** kontekstu `org_dev_local`; nie ma pełnego IAM/tenant isolation.
- **Nie umieszczaj** tu prywatnego eksportu ChatGPT, tokenów, danych klientów, osobistych wspomnień NeurOSA ani innych wrażliwych artefaktów.
- Żądania do modelu NVIDIA w chmurze wymagają oddzielnej sesji operatora, odpowiedniego originu, potwierdzonego darmowego modelu i wspólnego limitu. Sama konfiguracja klucza `NVIDIA_API_KEY` nie oznacza aktywnego modelu.
- `OSA_ZERO_COST_ONLY=true` to część warunku kosztowego; operator musi potwierdzić dokładny model, darmowy dostęp i ważność polityki. Bez potwierdzenia **nie wykonuj testu providerem**.
- Dane wielu modułów są w `PROCESS_MEMORY`; `localStorage` zapisuje historię wyłącznie w danej przeglądarce. Nie myl tego z trwałą bazą cloud.
- Worker, MCP/A2A, live Memory i deployment cloud są nadal częściowo `GATED` lub `PLANNED`. Nie odblokowuj ich wyłącznie flagą.

Konfiguracja: [OPERATOR.md](docs/release-v0.1.0/OPERATOR.md). Rozdzielenie publicznego demo od uprawnień i szczegóły weryfikacji: [AUDYT](docs/release-v0.1.0/AUDYT_DODATKOWY_2026-10-17.md) i [BRAMKI](docs/release-v0.1.0/BRAMKI.md).

## Modelowe wykonanie i zakres proof

Dla zatwierdzonego scenariusza `NVIDIA → tool_calls → osa_sha256 → Runtime → Evidence → ProofReceipt → Replay` model musi rzeczywiście zwrócić poprawne `tool_calls`; deterministyczny router SHA-256 nie zastępuje tego dowodu. Narzędzie `osa_sha256` jest odczytowe. Brak `provider_response_id`, niezatwierdzone narzędzie lub niespełniona polityka kosztowa kończą się odmową.

`ProofReceipt` potwierdza integralność i zakres wykonania **w zaufanym procesie**. Nie stanowi niezależnej atestacji NVIDIA ani obiektywnego poświadczenia prawdziwości odpowiedzi modelu.

Źródła: [NVIDIA_BRIDGE.md](docs/NVIDIA_BRIDGE.md), [PROOF_PROTOCOL_V2.md](docs/PROOF_PROTOCOL_V2.md), [OSA_UNIFIED_RUNTIME_V1.md](docs/OSA_UNIFIED_RUNTIME_V1.md).

## Domknięcie v0.1.0

Pierwsze wydanie wymaga oddzielnych dowodów dla: bezpieczeństwa publicznego demo, autoryzowanego bezpłatnego modelu, prawdziwego Redis, pełnego modelowego E2E, trwałego odczytu między instancjami i zaakceptowanego wydania.

Po zaliczeniu bramek — i dopiero za zgodą operatora na dokładny commit i środowisko — nastąpi merge PR #16, tag `v0.1.0` i GitHub Release. Kolejne zmiany powinny być inkrementalne (`v0.1.x`), bez przebudowy całego frameworka.

[Historia zmian](CHANGELOG.md) · [Projekt release notes](docs/release-v0.1.0/RELEASE_NOTES.md) · [Weryfikacja z execution_id](docs/release-v0.1.0/WERYFIKACJA.md)
