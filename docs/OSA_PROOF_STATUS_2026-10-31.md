# OSA Proof — stan kodu, testów i granic zaufania (31.10.2026)

> **Status: LOCAL VALIDATION PASS / PRODUCTION ACCEPTANCE BLOCKED.** Dokument odróżnia wynik operatora na Windows od CI, Vercel Preview i odbioru produkcji. Nie jest certyfikatem bezpieczeństwa ani dowodem wdrożenia produkcyjnego.

## Wersje i podstawa faktów

| Obiekt | Weryfikowany stan |
| --- | --- |
| Repozytorium | `HazEOskA/osa-proof` |
| Gałąź analizowana | `fix/proof-source-attribution-v1-20261031` |
| SHA kodu sprawdzonego przez operatora | `fc4756fa35bdb71b8f6c5c22ca92c54e04b6eaf5` |
| System testowy | Windows, Node.js `24.17.0`, npm `11.13.0` |
| `npm test` | **308 testów: 305 PASS, 0 FAIL, 3 SKIP** (log operatora) |
| `node --throw-deprecation scripts/build-dashboard.cjs` | **FULL VALIDATION PASS - DEP0190 CHECKED**, zbudowany `dashboard-dist` (log operatora) |
| Lokalny dashboard | TypeScript `tsc --noEmit` + Vite `5.4.11` PASS; 116 modułów |
| GitHub Actions dla powyższego SHA | Brak potwierdzonego uruchomienia w odczycie repo; **UNKNOWN** jako CI-pass |
| Status gałęzi względem `main` przed dokumentacją | 7 commitów przed, 0 za; **bez merge** |
| Deployment / produkcyjne E2E | **Nie objęte powyższą walidacją** |

Należy ponowić testy na końcowym SHA po zmianach dokumentacji. Wynik z `fc4756f` dotyczy **kodu sprzed commita dokumentacyjnego**, nawet jeżeli w tym commicie nie zmienia się runtime. Trzy `SKIP` nie są PASS. `READY` w Vercel oznacza gotowy artefakt Preview, a nie produkcyjną akceptację.

## Co implementacja obejmuje

1. **Team Graph, Mission Kernel i lokalne misje:** runtime, trace, evidence, deterministic verifier, Proof Receipt v2, replay; lokalny `FileMissionStore` z compare-and-swap rewizji, blokadami i snapshotami.
2. **Attribution Gate v1 DEFAULT_ON:** rozpoznaje obsługiwane twierdzenia o danych zewnętrznych w output/raportach i jawnych artefaktach HTML/JS/TS; próbuje dopasować je do runtime-owned wywołań `context.callTool()`. Przy braku źródła / niezgodności / niewspieranym przypadku zwraca `CLAIM_UNSUPPORTED`, `CLAIM_VALUE_MISMATCH` lub `CLAIM_COVERAGE_INCOMPLETE`. Podstawowe liczby, jednostki CSS i wersje bez kontekstu nie są automatycznie roszczeniami faktycznymi.
3. **ToolCallRecord i receipt:** runtime wiąże `execution_id`, `operation_id`, `agent_id`, żądanie i odpowiedź ich hashami oraz `tool_call_refs` / `tool_call_root`. Evidence podane przez wykonawcę nie może udawać runtime-owned call. `verifyProofReceipt` i `verifyCompletedMission` kontrolują obsługiwane powiązania i kolejność zdarzeń.
4. **Dashboard:** zachowuje widoki Proofs/Replay, pokazuje zakres atrybucji, przyczyny odrzuceń i brak gwarancji egress/podpisu. Budowanie kopiuje `dashboard-src/` (archiwum vendor tylko jako fallback), uruchamia `npm-cli.js` przez `process.execPath` z `shell: false` i publikuje `dashboard-dist` wraz z `docs/`.
5. **HTTP docs:** tabela generowana z `packages/control/src/index.ts`; 87 par metod i ścieżek w obserwowanym rejestrze. `npm run docs:check` ignoruje różnice LF/CRLF, nie ignoruje zmiany opisów/trasy.

## Granice bezpieczeństwa i semantyki

- `egress_status: NOT_ENFORCED`: `callTool()` nie jest sieciowym sandboxem; nie blokuje dowolnego `fetch`, gniazd ani procesów wykonawcy. Wdrożenie ograniczeń egress wymaga polityk OS/kontenera/sieci.
- `signature_status: UNAVAILABLE`: SHA-256 i łańcuchy zależności sprawdzają spójność, ale nie są podpisem ani zewnętrznym poświadczeniem pochodzenia. Przepisanie i ponowne zahashowanie całego bundle może dać wewnętrznie spójny fałszywy wynik.
- `trustedNoExternalFacts: true` jest wyjątkiem **tylko zaufanego hosta** dla sklasyfikowanego builda. Nie należy przekazywać go przez mission input, payload HTTP ani odpowiedź agenta.
- Attribution v1 to **ograniczona heurystyka**, nie pełne NLP, walidacja każdego faktu, atestacja integracji API ani skan bezpieczeństwa generowanego kodu.
- `FileMissionStore` to **lokalny** magazyn. Windows wykonuje `file.sync()` i atomowy rename; pomija nieobsługiwane `directory.sync()`; na POSIX synchronizacja katalogu pozostaje wymagana. Nie ma rozproszonego fencing ani automatycznej bezpiecznej rekoncyliacji martwych blokad.
- Memory / NeurOSA, NVIDIA E2E `tool_calls`, OAuth, wielodzierżawność i trwałość chmurowa nie uzyskują statusu PASS na podstawie lokalnego pakietu.
- Ostrzeżenie npm `Unknown user config "store-dir"` wystąpiło przy lokalnym buildzie, lecz nie przerwało procesu; jego źródło nie zostało ustalone.

## Powiązane dokumenty

- [Attribution Gate v1](./ATTRIBUTION_GATE_V1.md) — kontrakt, ograniczenia, testy fail-closed.
- [Proof Protocol v2](./PROOF_PROTOCOL_V2.md) — hashe, integralność, binding, ograniczenia atestacji.
- [Mission Kernel](./MISSION_KERNEL_V1.md) — cykl misji, pliki, blokady, trwałość.
- [Dashboard Integration](./DASHBOARD_INTEGRATION.md) — build i zakres dashboardu.
- [Historyczny bilans Preview 28.10](./OSA_PROOF_PREVIEW_STATUS_2026-10-28.md) — obserwacje operatora, nie obecny wynik produkcyjny.

**Następna bramka:** aktualizacja dokumentacji na gałęzi → odczyt i walidacja diffu oraz `docs:check` → osobna zgoda na fast-forward `main` z uwzględnieniem automatycznych buildów/deploymentów Vercel.
