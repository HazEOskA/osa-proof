# Dokumentacja — propozycja aktualizacji na 03.11.2026

**Status:** `DOCUMENTATION DRAFT / NOT APPLIED` · **Target:** `HazEOskA/osa-proof` (`main` @ `9aa81ab667a12b6ab38ff4d6bd61a1d7c52a41e6`).

## Zakres przygotowany do code review

| Plik | Rodzaj zmiany | Uzasadnienie |
| --- | --- | --- |
| `README.md` | **Zastąpienie obecnego README w przyszłym, osobno zatwierdzonym commicie** | Aktualna narracja produktu, moduły, status live, ograniczenia, Quickstart i wejście do docs |
| `docs/README.md` | Nowy | Jeden indeks i hierarchia dowodów |
| `docs/STATUS_2026-11-03.md` | Nowy | Zaktualizowany stan na przypiętym SHA; nie miesza historycznych wyników z aktualnym live |
| `docs/HISTORY_AND_WORKSPACE_GAPS_2026-11-03.md` | Nowy | Root causes: Team Graph, misje i czaty; OAuth obserwowane, RCA unknown |
| `docs/PERSISTENCE_ARCHITECTURE_V1_PROPOSAL.md` | Nowy | Własny, host-agnostyczny storage i migration gates — bez hosta i provisioningu |
| `docs/PROOF_EXPORTS_GUIDE.md` | Nowy | Różnica między ChatDelivery, MissionRecord a Live Trace oraz niezależny audit |
| `docs/DOCS_CHANGELOG_2026-11-03.md` | Nowy | Zakres, rollback i warunki przyjęcia tej aktualizacji |

## Źródła

- Repo `main` @ `9aa81ab667a12b6ab38ff4d6bd61a1d7c52a41e6`, odczyt przez GitHub 03.11.2026.
- `package.json`, `dashboard-src/package.json`, `api/osa.ts`, `packages/runtime/src/mission-store.ts`, `dashboard-src/src/build.tsx`, `dashboard-src/src/data/data.ts`, `dashboard-src/src/lib/chat-history.ts`, `dashboard-src/src/views/BuildWorkspace.tsx`, `dashboard-src/src/views/JeversonChat.tsx`.
- Istniejące historyczne raporty w `docs/`.
- Prywatny, dostarczony przez operatora eksport ChatDelivery przeanalizowany **lokalnie**: SHA bundle, ProofReceipt, Evidence, trace i HTML. Nie kopiowany do publicznej dokumentacji.

## Co celowo zostało nietknięte

- Żaden plik kodu, testu, workflow, schematu SQL, migracji czy konfiguracji nie jest zmieniony.
- Historyczne raporty 28.10 i 31.10 zachowują oryginalne wyniki i ich zakres.
- Brak zmian obrazów; starego bannera z niezatwierdzoną stylistyką nie przeniesiono do nowego README. Użyto istniejącego faviconu i typografii GitHub Markdown.
- Brak importu prywatnej historii chatów, żadnego pokazywania sekretów ani deploymentu.

## GATE przyjęcia dokumentacji

1. Operator akceptuje treść, zakres i wizualny układ README.
2. W repo sprawdza się `git diff --check`, relatywne linki i poprawność Mermaid.
3. `npm run docs:check` i lokalny Markdown lint (jeśli dostępny) przechodzą na dokładnym doc commit SHA; testy nie mają być raportowane jako PASS bez uruchomienia.
4. Dokumentacyjny commit w jednej zatwierdzonej gałęzi; bez automatycznego merge/deploy bez osobnego approval.
5. Rollback = przywrócenie poprzedniego README i usunięcie nowych plików docs w kontrolowanej zmianie; historycznych źródeł nie nadpisywano.

**CURRENT:** pliki gotowe do przeglądu. **MUTATION GATE:** AWAITING APPROVAL — brak commit/push/merge/deploy.
