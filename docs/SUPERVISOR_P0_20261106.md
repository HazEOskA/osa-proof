# OSA Proof — Supervisor P0 (Architecture Lock)

## GOAL
Każda odpowiedź zwykłego czatu NVIDIA przechodzi przez kontrolę Supervisora **przed** potwierdzeniem APR i publikacją. Błąd potwierdzony deterministycznie kieruje odpowiedź do jednej korekty Workera. Weryfikacja treści i poprawność samego wykonania to różne rzeczy.

## Kanoniczny przebieg
1. Uwierzytelniona sesja i scoped NeurOSA — istniejący przepływ, bez zmian.
2. BrainControlPlane tworzy przypięty plan misji (dwóch agentów).
3. Worker NVIDIA zwraca roboczą odpowiedź z SHA-256 i identyfikatorem dostawcy.
4. Supervisor otrzymuje rzeczywisty handoff od Workera i sprawdza jawne równania deterministycznym, domenowo niezależnym mechanizmem.
5. Gdy wykryto sprzeczność, do NVIDIA trafia szczegółowa diagnoza i dozwolona jest **jedna** ponowna próba; model dostaje ten sam oryginalny prompt, historię i zakres pamięci oraz korektę jako dodatkową wiadomość (nie uprawnienia).
6. Supervisor wydaje `RELEASED` albo `REJECTED`, z listą prób i hashami. `UNKNOWN` to **brak dowodu prawdziwości**, nie potwierdzenie całej odpowiedzi; nie powoduje nieuzasadnionego blokowania każdej rozmowy.
7. APR weryfikuje dwa agenty, handoff, evidence, odtworzenie i obowiązkowe wymaganie `supervisor_release:publishable=true`.
8. Odrzucone wykonanie zwraca ograniczony `review` i błąd `SUPERVISOR_REPAIR_EXHAUSTED`, bez publikacji przyjętej odpowiedzi. Udany wynik otrzymuje `audit` z Supervisor + Brain + APR.

## Ograniczenia i bezpieczeństwo
- Implementacja P0 wykrywa **tylko jawne równania matematyczne** typu `2+2=5` lub `18 000 zł – 30 000 zł = –12 000 zł`. Nie weryfikuje ukrytej arytmetyki w zdaniu, autentyczności źródeł, prawa, kodu ani pełnej jakości semantycznej.
- `Supervisor PASS` dotyczy wyłącznie jawnych obliczeń; `content_assurance` pozostaje niezależne i `UNKNOWN` bez zaufanych źródeł.
- Fałszywy albo niejednoznaczny format: `UNKNOWN`, nie automatyczny `BLOCKED`.
- Nie wykonujemy żadnych transakcji, deployów, zapisów w repo lub użycia narzędzi z promptu. Zwykły czat pozostaje read-only.
- Repair max 1 (max 2 wywołania NVIDIA), bez nieskończonej pętli. Retry może zużyć dodatkowe tokeny; limity i zasady operatora pozostają aktywne.
- Supervisor i jego pola to kontrola aplikacyjna, **nie zewnętrzny podpis kryptograficzny**. SHA wiąże wersje odpowiedzi z dowodami, nie potwierdza prawdy.
- Gdy provider nie odpowiada w trakcie korekty, wykonanie jest niepotwierdzone — brak automatycznej publikacji niezweryfikowanego tekstu.
- Auth, OAuth, NeurOSA, istniejący Hermes P1, tool policy i inne ścieżki misji pozostają bez zmian.

## Testy odbiorcze
- Równanie poprawne: 1 wywołanie, `RELEASED`, Supervisor + APR evidence.
- Równanie błędne: 2 wywołania, korekta, `RELEASED` i zapis obu prób.
- Dwie błędne próby: `REJECTED`, APR FAIL, brak zdarzenia SSE `complete`.
- Nieznane twierdzenie: `UNKNOWN` bez fikcyjnego `SUPPORTED`.
- Dokładne SHA i powiązanie danych, replay i próby tamperingu.
- Regresje pamięci, autoryzacji, narzędzi, przeglądarki, Androida/desktop i pełny build.
- Draft PR bez merge/deploy produkcyjnego.

## P1 poza zakresem
Zależny od zaufanych narzędzi routing sprawdzania kodu, faktów, prawa i niejawnych rachunków; pełny semantyczny coverage; polityka publikacji zależna od ryzyka. Wymaga nowego scope i zgody.
