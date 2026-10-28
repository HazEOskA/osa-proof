# OSA Proof × NeurOSA — bilans chronionego Preview (28.10.2026)

> **STATUS: PREVIEW PARTIAL PASS — PRODUKCJA BLOCKED.** Ten dokument oddziela **kod i potwierdzony deployment**, **obserwacje operatora w UI** oraz **niezweryfikowane gwarancje**. Nie nadpisuje historycznych raportów testowych.

## Identyfikacja

| Obiekt | Wartość | Źródło / znaczenie |
|---|---|---|
| Repo | `HazEOskA/osa-proof` | GitHub |
| Gałąź Preview | `fix/osa-proof-neurosa-protected-preview-20261028` | **nie** `main` |
| Commit kodu ocenianego Preview | `56dd60612f844faa9380c3243fe7eb9074a618d7` | potwierdzony przez Vercel przy deploy |
| Vercel Deployment ID | `dpl_CsbTuwg6rADtvm3QTYKbc5sv9Jhf` | `READY` dla Preview, nie produkcji |
| NeurOSA | zewnętrzny Brain API na Railway | konfiguracja serwerowa; token tylko w ENV |
| Załącznik źródłowy misji 47-krokowej | **BRAK w repo i tym przeglądzie** | wymaga przekazania eksportu przez operatora |

**Ochrona:** prywatna NeurOSA jest montowana wyłącznie dla zatwierdzonej gałęzi i dokładnej domeny deploymentu Vercel, przy `OSA_PREVIEW_SINGLE_OPERATOR=enabled` i Vercel Deployment Protection. Uwaga: mechanizm pojedynczego operatora jest uproszczeniem testowym, **nie** produkcyjnym IdP/RBAC. Nie publikować chronionych linków ani obejść ochrony. Nie ujawniać wartości ENV.

## Co zostało zaobserwowane

| Element | Status | Granica dowodu |
|---|---|---|
| Vercel Preview | **READY** | status i SHA w API Vercel; nie dowód pełnej poprawności aplikacji |
| API pamięci NeurOSA | **AVAILABLE w teście operatora** | ekran `/api/memory/status` potwierdził dostępność; nie persistence po restarcie Railway |
| Zapis wiadomości NeurOSA | **potwierdzony w UI operatora** | komunikat o potwierdzonym zapisie; niezależny readback po restarcie jeszcze nie wykonany |
| NVIDIA — zwykły czat | **odpowiedź obserwowana w UI** | po poprawie błędów 404 i timeout; nie SLA ani pełny test modeli |
| ChatDelivery | **wygenerowany artefakt i dostępne eksporty obserwowane w UI** | widoki Proof/Evidence i podgląd; **plików z tej misji nie audytowano offline** |
| Replay i trace | **47 pozycji zgłoszonych przez operatora** | brak ID misji i niezależnie przekazanego trace do porównania |
| Regresja Final Boss lokalnie | **272 PASS / 0 FAIL / 3 SKIP raportowane wcześniej** | fixture, sesje testowe i niesandboxowani wykonawcy; nie ponowiono całego zestawu dla ostatniego SHA |

## Dwie różne ścieżki, których nie wolno mieszać

**A. ChatDelivery:** `Czat floty → Utwórz artefakt`. Zwraca `osa.chat_delivery.v1` z `bundle_sha256`, `record`, `run`, `artifact`, `report`; sześć plików do pobrania, trace JSONL i samodzielny Replay HTML. Klient weryfikuje integralność, ale Replay **odtwarza zapis**, nie uruchamia ponownie operacji. Model generuje treść, role wykonują kontrole. `OSA_DELIVERY_MODEL` jest niezależny od `NVIDIA_MODEL` czatu.

**B. Studio / Mission Kernel:** przycisk `Pobierz zapis misji` dostarcza rekord `osa.mission.v1`. Użyj `node scripts/verify-mission-record.cjs <record.json> [evidence-content-map.json]`. Testy z `docs/final-boss/` pochodzą z lokalnego środowiska z prawdziwym lokalnym Brain API i testowymi executorami; nie stanowią same z siebie dowodu 47-pozycyjnej misji widzianej przez operatora.

## Dalsze ograniczenia — nie nazywać PASS

- Izolowany sandbox dla rzeczywistych workerów — brak potwierdzonego live testu.
- Produkcyjne OAuth, RBAC i pełna izolacja tenantów — niepotwierdzone.
- Realny restart/readback trwałej bazy NeurOSA na Railway — niepotwierdzony; nie wymuszać restartu dla audytu.
- Trwały magazyn misji i artefaktów w chmurze, współdzielone ogrodzenie ponowień — niepotwierdzone.
- Pełny zewnętrznie niezależny Proof Bundle oraz zakotwiczenie autentyczności źródła — brak; hashe umożliwiają sprawdzenie spójności, nie pochodzenia.
- Funkcjonalna i bezpieczeństwowa jakość kodu wygenerowanego przez NVIDIA — wymaga osobnego audytu.
- 47 pozycji w Replay **nie** oznacza automatycznie 47 wykonanych operacji. Trzeba policzyć niezależnie zdarzenia timeline, agent starts, realne wywołania narzędzi i przypięte evidence.

## Następna bramka

Dostarczyć Hermesowi **eksport konkretnego wykonania** i zlecić audyt offline, na lokalnych kopiach, bez dostępu do produkcji, sekretów lub prywatnej pamięci.

**Instrukcja:** [HERMES_AUDIT_QUICK_START.md](./HERMES_AUDIT_QUICK_START.md). **Werdykt bezpieczeństwa:** [SECURITY_VERDICT.md](./final-boss/SECURITY_VERDICT.md).

Status aktualny wyłącznie dla powyższego SHA i zakresu obserwacji. Każde `UNKNOWN` pozostaje `UNKNOWN`, dopóki nie ma dowodów.
