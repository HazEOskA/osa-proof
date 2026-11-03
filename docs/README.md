# Dokumentacja techniczna OSA Proof

**Punkt odniesienia:** 3.11.2026 · `main` @ `9aa81ab667a12b6ab38ff4d6bd61a1d7c52a41e6`. Poniższy indeks odróżnia aktualny stan kodu, obserwacje operatora, historyczne testy i projekty przyszłych zmian. Nie zastępuje weryfikacji konkretnego deploymentu.

## Zacznij tutaj

| Pytanie | Dokument | Status |
| --- | --- | --- |
| Co działa, a co jeszcze nie? | [STATUS_2026-11-03.md](./STATUS_2026-11-03.md) | Bieżący bilans na wskazanym SHA |
| Dlaczego znika Team Graph/historia misji i dlaczego czaty są pomieszane? | [HISTORY_AND_WORKSPACE_GAPS_2026-11-03.md](./HISTORY_AND_WORKSPACE_GAPS_2026-11-03.md) | Diagnoza w kodzie, plan bez mutacji |
| Jak będzie wyglądał własny, trwały storage? | [PERSISTENCE_ARCHITECTURE_V1_PROPOSAL.md](./PERSISTENCE_ARCHITECTURE_V1_PROPOSAL.md) | **PROPOSED / HOST UNKNOWN** |
| Jak odróżniać `VERIFIED` od dowodu rzeczywistej operacji? | [PROOF_EXPORTS_GUIDE.md](./PROOF_EXPORTS_GUIDE.md) | Runbook READ_ONLY |

## Kontrakty źródłowe

- [TEAM_GRAPH_CONTRACT_V1.md](./TEAM_GRAPH_CONTRACT_V1.md) — kanoniczny graf wykonawczy.
- [MISSION_KERNEL_V1.md](./MISSION_KERNEL_V1.md) — lifecycle, MissionStore i rewidowanie stanu.
- [PROOF_PROTOCOL_V1.md](./PROOF_PROTOCOL_V1.md) oraz [PROOF_PROTOCOL_V2.md](./PROOF_PROTOCOL_V2.md) — hash, binding i granica weryfikatora.
- [ATTRIBUTION_GATE_V1.md](./ATTRIBUTION_GATE_V1.md) — provenance wywołań narzędzi i warunki fail-closed.
- [P0_UNIFIED_LIVE_TRACE_20261103.md](./P0_UNIFIED_LIVE_TRACE_20261103.md) — Live Trace/SSE i uczciwe anulowanie.
- [P0_DURABLE_EXECUTION_20261103.md](./P0_DURABLE_EXECUTION_20261103.md) — lokalny durable worker, ale **Production BLOCKED**.
- [NEXT_STEP_MEMORY_ACTIVATION.md](./NEXT_STEP_MEMORY_ACTIVATION.md) — oddzielny plan trwałego NeurOSA i MissionStore.
- [BUILD_RESEARCH_AND_VERIFICATION.md](./BUILD_RESEARCH_AND_VERIFICATION.md) — historyczny zakres Builder/Studio.

## Audyty historyczne — nie łączyć statusów

- [OSA_PROOF_STATUS_2026-10-31.md](./OSA_PROOF_STATUS_2026-10-31.md) — **305 PASS / 0 FAIL / 3 SKIP** na innym, wcześniejszym SHA.
- [OSA_PROOF_PREVIEW_STATUS_2026-10-28.md](./OSA_PROOF_PREVIEW_STATUS_2026-10-28.md) — chronione Preview z 28.10, nie bieżąca produkcyjna akceptacja.
- [HERMES_AUDIT_QUICK_START.md](./HERMES_AUDIT_QUICK_START.md) — offline audyt konkretnych eksportów; uważnie sprawdzaj wersję narzędzi względem bazowego SHA.
- [final-boss/OSA_PROOF_FUNCTION_MATRIX.md](./final-boss/OSA_PROOF_FUNCTION_MATRIX.md) — historyczna macierz wybranych capability; nie aktualna pełna inwentaryzacja.

## Hierarchia dowodów

1. **Zgodność z kodem na przypiętym SHA** — dowodzi wyłącznie, co kod implementuje.
2. **Raport lokalnego testu** — dowodzi wyniku na danym środowisku i SHA.
3. **Eksport konkretnej misji, sprawdzony offline** — dowodzi spójności zapisanych materiałów.
4. **Obserwacje live + niezależna weryfikacja rzeczywistego wykonawcy** — konieczne dla roszczeń realnego E2E.
5. **Test po restarcie, cross-device, isolation, security** — konieczny przed deklaracją produkcyjnej trwałości.

`UNKNOWN`, `NOT_REQUIRED`, `BLOCKED` i `SKIP` **nie są** `PASS`. `VERIFIED` jest werdyktem w granicach jawnych wymagań Proof.

## Higiena publikacji

Nie commituj do publicznego `docs/` plików ChatDelivery z danymi prywatnymi, tokenami, identyfikatorami sesji, pełnym kontekstem NeurOSA ani surowymi promptami bez przeglądu i redakcji. Znane testy z prywatnego eksportu opisujemy w formie **zagregowanych, pozbawionych danych osobistych wyników**.

Dokumentacja nie wprowadza nowych uprawnień, API ani środowisk. Każda modyfikacja infrastruktury wymaga osobnej zgody.
