# Plan wdrożenia — częściowy, wymaga uzupełnienia pełnym audytem

Nie zastępuje Architecture Lock ani nie jest deklaracją zakończenia wszystkich luk.

| Kolejność / priorytet | Plik / moduł i zakres | Zależność i ryzyko | Test akceptacyjny i DONE | Dowód |
|---|---|---|---|---|
| 1 / P0 | `apps/api/src/index.ts`, `packages/session`: autoryzacja i izolacja wszystkich zasobów | rzeczywista tożsamość; ryzyko wycieku | dwa tenanty: obce read/write zawsze 403, brak wycieku | częściowe testy; nie pełny аудит |
| 2 / P0 | `packages/runtime/src/mission-store*`, `apps/api/src/server.ts`: trwałe state/CAS/recovery | storage; ryzyko dublowania side effects | restart i dwa procesu, jedno wykonanie, запись odczytana | test lokalnego FileMissionStore, brak produkcyjnego dowodu |
| 3 / P0 | `packages/adapters/src/brain.ts`, `packages/brain`: realny izolowany NeurOSA recall, scope i provenance | dedykowany brain, auth; ryzyko cross-tenant i injection | status→recall→plan→reflection, 403 foreign scope, restart, readback | dotychczas kontrolowane transporty |
| 4 / P0 | `packages/proof-core/src/mission-verifier.ts`: sprawdzenie polityki, complete bundle i niezależna weryfikacja | kontrakty receipts; hash nie dowodzi autentyczności | odmowa dla brakującego/zmienionego evidence, błędnych ID i niedozwolonego executora | poprawka polityki i test; pełny bundle brak |
| 5 / P1 | `packages/fleet`, `apps/worker`: realni workerzy read-only i cleanup | izolacja i limity; ryzyko zapisu | dwa rzeczywiste zadania, odmowa zapisu, timeout i cleanup | brak live testu |
| 6 / P1 | `apps/api/src`, `dashboard-src/src`: misja repo→wynik, artefakt, replay | 1–5 | desktop/mobile i restart, pobrany bundle zweryfikowany poza UI | brak pełnego E2E |
| 7 / P1 | `packages/adapters`: realne narzędzia i model routing | granty, budżety | realne wywołanie, receipt i odmowa bez uprawnień | brak bieżącego live dowodu |
| 8 / P1 | `.github/workflows`, deploy i recovery | 1–7 | CI dokładnego SHA, chroniony preview, udokumentowany rollback | nie sprawdzono |
| 9 / P2 | pozostałe moduły z macierzy po pełnej inwentaryzacji | poprzednie bramki | testy rzeczywistych funkcji, niezależne od fixture | UNKNOWN |

Produkcja, migracja SQLite i zmiana aktywnej ścieżki wymagają osobnej zgody. Szczegółowy plan każdej funkcji wymaga dokończenia audytu; nie należy traktować tej tabeli jako kompletnej.
