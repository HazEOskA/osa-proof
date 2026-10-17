# Dodatkowy audyt OSA Proof v0.1.0 — 17.10.2026

**Stan: BLOCKED / KANDYDAT.** Audyt wykonany tylko do odczytu na `release/osa-proof-v0.1.0@4c375e8058e30b06f178e261ccb32e4bb45f61b2` i porównany z `main@512a6e17048db549f8b515396b2d7710b40af781`. Do repo w tym audycie dopisywana jest wyłącznie dokumentacja. Nie dokonano testu płatnego modelu, zmiany sekretów ani deployu.

## Zweryfikowane fakty (nie mylić z claimami)

- PR [#16](https://github.com/HazEOskA/osa-proof/pull/16) jest otwarty jako DRAFT; brak merge i formalnego tagu/release v0.1.0.
- **Aktualny alias produkcyjny** `osa-proof-three.vercel.app` jest przypięty do Vercel `dpl_B8s5QZV1t5CMfy6qm453rkFMs2Bh`, `target=production`, `state=READY`, kod `4c375e8058e30b06f178e261ccb32e4bb45f61b2` z gałęzi release. To fakt o aktualnej trasie aliasu i stanie deploymentu, **nie** potwierdzenie powodzenia żądań do aplikacyjnego API lub testu płatnego modelu.
- **Dawny produkcyjny deployment** `dpl_dwH79xqLhkcSn5zzwjzmStPwMKmJ` / `512a6e1` jest punktem historycznym, nie aktualnym przypięciem aliasu. Dokumenty zawierające sformułowanie „produkcja pozostaje na 512a6e1” opisują poprzedni moment i nie mogą być używane jako bieżący status.
- Ostatnie kontrole CI na `4c375e8`: [backend/build](https://github.com/HazEOskA/osa-proof/actions/runs/38985293601), [browser mobile/desktop](https://github.com/HazEOskA/osa-proof/actions/runs/38985293682), [Fleet HTTP/SSE](https://github.com/HazEOskA/osa-proof/actions/runs/38985293598) — **3/3 SUCCESS**. CI nie wykonuje produkcyjnego testu modelu NVIDIA ani prawdziwego Redis.
- Konfiguracja Vercel ma `NVIDIA_API_KEY` jako `sensitive` dla Preview/Production oraz `OSA_ZERO_COST_ONLY` w Production. Odczyt nazw i targetów **nie** potwierdza wartości, ceny modelu, dostępności salda ani konfiguracji wymaganych `OSA_OPERATOR_*`, `OSA_NVIDIA_FREE_*` i `OSA_QUOTA_REDIS_*` — te zmienne nie pojawiły się w odczytanej liście.
- Pierwotne `234 PASS / 3 SKIP` dotyczy wcześniejszej wersji PR. Po kolejnych zmianach historia wyników wskazuje `236 PASS` i `237 PASS` (testy lokalne, szczegóły w [WERYFIKACJA.md](WERYFIKACJA.md)); nie łącz tych sum w jeden pomiar. Zamiast dawnych screenshotów oceniaj kod i testy konkretnego commitu.

## Macierz obserwacji i działań

| Priorytet | Obserwacja z kodu | Skutek / zakres | Warunek zamknięcia |
| --- | --- | --- | --- |
| **P0** | `apps/api/src/operator-access.ts`: `openVercelAccess` dopuszcza jawne `VERCEL=1`, `VERCEL_ENV=preview/production`, `OSA_AUTH_MODE=open`; `authenticatedSession` zwraca wspólną `OPEN_MODE_SESSION`. | Anonimowy panel i część natywnych tras są dostępne w jednym współdzielonym kontekście; nie ma izolacji per użytkownik. Nie używać tego jako środowiska danych osobowych/klientów. | Jawnie rozdzielić publiczną demonstrację od chronionych danych i mutacji albo wymusić sesję w każdym środowisku z prawdziwymi danymi. Testy odmów w przeglądarce i API, w tym sesji obcej organizacji. |
| **P0** | `apps/api/src/index.ts`: w `open` wymóg `Origin` dla wszystkich POST działa tylko przy `scoped`; dla modeli jest osobna kontrola cookie+origin, a tryb provider/integracji ma blokadę zewnętrznych zapisów. | Autoryzacja modelu i fail-closed zewnętrznych executorów **nie oznaczają**, że wszystkie pozostałe mutacje w `open` wymagają operatora. Wspólne konfiguracje, kolejki i wyniki są danymi demonstracyjnymi. | Ocenić granicę autoryzacji per trasa i wrażliwość mutacji. Dokumentować dokładne wyjątki lub rozszerzyć gate, bez zabicia publicznego demo. |
| **P0** | `apps/api/src/nvidia.ts` wymaga dla chmury aktywnego kosztowego gate, uwierzytelnionej sesji operatora, kontrolowanego modelu; `model-quota.ts` wymaga Redis REST. | Brak potwierdzenia aktualnego darmowego dostępu i działającego atomowego limitu; publiczne `/api/nvidia/status` nie dowodzi użycia providera. | Potwierdzenie free-only na konkretnym koncie, test Redis dwóch instancji oraz rzeczywiste NVIDIA `tool_calls` → Runtime → Evidence → ProofReceipt → Replay na autoryzowanym Preview. |
| **P0** | `api/osa.ts` używa procesu `ApiState`; `/build/status` raportuje `PROCESS_MEMORY` oraz `durable_cloud_storage:false`. | Restart, skala serverless lub nowe urządzenie mogą utracić misje, kolejkę i historię; localStorage i `FileMissionStore` nie zapewniają trwałości wieloinstancyjnej. | Wskazać istniejący zaakceptowany backend trwały, przejść test zapisu/odczytu z innej instancji oraz restart. Bez zgody na nowy płatny provisioning. |
| **P1** | Dokumenty historyczne z PR-ów #13/#15 i stare sekcje `WERYFIKACJA.md` odnoszą się do innej polityki auth i commitu. | Łatwo pomylić demonstrację z wydaniem i stare `BLOCKED` z bieżącym stanem. | Bieżący status i manifest źródeł przypinać do SHA, targetu, aliasu, środowiska i czasu obserwacji. Historyczne testy wyraźnie oznaczać. |
| **P1** | `docs/release-v0.1.0/OPERATOR.md`: nieodpowiedni dla aktualnego aliasu `OSA_OPERATOR_ORIGIN` domyślny `VERCEL_URL` może wskazywać unikalny hostname deployu. | Logowanie do modelu pod stałym aliasem nie musi być zgodne z origin sesji, jeśli nie ustawiono go jawnie. | Dla logowania pod `https://osa-proof-three.vercel.app` skonfigurować dokładnie ten origin, tylko w uprawnionym środowisku; test `Origin`/cookie i `/api/auth/access` po logowaniu. |
| **P1** | `apps/api/src/unified.ts` oraz ProofReceipt weryfikują wiązanie, integralność i część zdarzeń. | Hash/receipt nie są atestacją prawdziwości treści modelu ani podpisem NVIDIA. | Udokumentować zakres receipt, pochodzenie odpowiedzi serwera i ograniczenia odtwarzania bez trwałego backendu. |
| **P2** | `packages/brain`, Builder/Worker, MCP/A2A, NeurOSA, Web3 i regulated mają różne stany implementacji/konfiguracji. | Zielone testy kontraktów nie dowodzą pracy z rzeczywistym cloud, Docker, memory i blockchain. | Oznaczyć `GATED`/`PARTIAL` zgodnie z [MACIERZ.md](MACIERZ.md); nie rozszerzać v0.1 o kolejne silniki. |

## Kolejność działań bez rozbijania scope

1. **Bramka demo vs prywatne dane**: zatwierdzić, co może być publiczne w otwartym `OPEN_PRODUCTION`; publiczny formularz i stan fixture **nie są** produkcyjną autoryzacją. Do czasu testów nie umieszczać sekretów, danych klientów i prywatnych eksportów w otwartym panelu.
2. **Operator + NVIDIA**: aktywować poprawnie ograniczony origin i scoped credentials w uprawnionym środowisku, bez wysyłania sekretów do czatu; sprawdzić aktualne warunki darmowego modelu. Brak potwierdzenia ceny oznacza brak wywołań.
3. **Quota**: użyć już zaakceptowanej usługi Redis REST; potwierdzić rzeczywisty atomowy EVAL przy konkurencyjnych żądaniach dwóch instancji. Brak usługi → `BLOCKED`.
4. **ONE FLOW**: prawdziwe `tool_calls` NVIDIA, jeden `execution_id`, oryginalny model response id, Runtime, Events, Evidence, dwa niezależne weryfikatory ProofReceipt, Replay, odmowy i odświeżenie.
5. **Durability**: wykorzystać zatwierdzony istniejący backend; test restartu, odczytu z innego urządzenia i konflikty CAS. Nie tworzyć bazy na koszt użytkownika bez zgody.
6. **Formalne wydanie**: dopiero po dowodach i autoryzacji konkretnego SHA/targetu: PR merge, release tag, GitHub Release. Nie utożsamiać wcześniej wykonanego deployu Preview/Production z `v0.1.0`.

## Granice audytu

To analiza źródeł oraz odczyt metadanych GitHub/Vercel. Nie przeprowadzono zewnętrznego testu penetracyjnego, fizycznego Androida, live Redis/NVIDIA, cloud persistence ani uwierzytelnionego scenariusza pod aliasem produkcyjnym. Dla takich prób wymagane są konfiguracja uprawnień, osobne dowody i (gdy płatne) jawna zgoda. **Nie zmieniono runtime, flag, sekretów ani deploymentów w ramach tego audytu.**

Źródła: [PR #16](https://github.com/HazEOskA/osa-proof/pull/16) · [BRAMKI](BRAMKI.md) · [MACIERZ](MACIERZ.md) · [WERYFIKACJA](WERYFIKACJA.md) · [OPERATOR](OPERATOR.md) · [WDROŻENIE](WDROZENIE_PRODUKCJA.md).
