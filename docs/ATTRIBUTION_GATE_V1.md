# Attribution Gate v1 — kontrakt i granice dowodowe

## Zakres
Brama w `OsaRuntime` rejestruje wykonane przez `context.callTool()` wywołania
narzędzi hosta. Wpis `ToolCallRecord` obejmuje `execution_id`, `operation_id`,
`agent_id`, `tool_ref`, hash kanonicznego żądania, odpowiedź oraz hash
kanonicznej odpowiedzi. Wynik i `tool_call_root` są związane z Proof Receipt.
Agent nie może wystawić `ToolCallRecord` przez pole `evidence`.

## Polityka aktywacji: DEFAULT_ON (poprawka P0)
Od teraz każdy `OsaRuntime` uruchamia sprawdzenie twierdzeń domyślnie.
Brak słów „temperatura”, „pogoda” lub „API” w celu misji **nie** wyłącza
bramki. Np. raport „Kurs bitcoina wynosi 70000 USD” bez żadnego
runtime-owned `ToolCallRecord` otrzymuje
`FAILED / CLAIM_UNSUPPORTED`.

Wewnętrzny host może jawnie utworzyć runtime z
`new OsaRuntime(registry, {trustedNoExternalFacts: true})` tylko dla
uprzednio sklasyfikowanego, czystego builda bez faktów zewnętrznych.
To parametr **zaufanego konstruktora runtime**, a nie `Mission`,
`Mission.input`, `Mission.policy` ani pole raportu. Te pola nie
zmieniają polityki. Przy ponownej weryfikacji opt-out wymaga osobnej
decyzji zaufanego hosta, nie samego wpisu w Proof Receipt.
`MissionKernel` pozostaje default-on.

Ta ochrona opiera się na rzeczywistej granicy zaufania aplikacji.
Nie wolno mapować HTTP body, BYOK payload ani tekstu agenta na
`trustedNoExternalFacts`. Bez odrębnej uwierzytelnionej kontroli
uprawnień hosta nie jest to niezależna kryptograficzna atestacja
klasyfikacji misji.

Dla domyślnego trybu **rozpoznane** twierdzenia o aktualnej pogodzie,
kursach i integracjach wymagają źródła; same liczby, numery wersji,
identyfikatory i parametry CSS nie uruchamiają odrzucenia. Brak
rozpoznanego faktu nie tworzy sztucznego twierdzenia do odrzucenia.
To nie oznacza pełnej walidacji faktów ani gwarantowanej detekcji
wszystkich twierdzeń z dowolnego kodu lub języka.

Verifier v1 czyta `report`, `answer`, `message`, `content`,
`artifact.content` oraz `temperature_celsius`. Pole `text` jest
analizowane tylko wtedy, gdy nie jest surowym wejściem narzędzia
technicznego. Z HTML wydzielany jest widoczny tekst i treść skryptów
bez uruchamiania kodu. Temperatury są porównywane z polami
`temperature`, `temp`, `temperature_celsius`, `temp_celsius`,
`celsius`; znane ceny/kursy z odpowiednimi polami `price`/`rate`.
Niezgodność: `CLAIM_VALUE_MISMATCH`; brak powiązanego źródła:
`CLAIM_UNSUPPORTED`; rozpoznane twierdzenie bez wspieranej mapy:
`CLAIM_COVERAGE_INCOMPLETE`. Nie jest to dowód pełnego rozumienia
języka naturalnego ani bezpieczeństwa wygenerowanego kodu.

Sformułowania o wykonaniu integracji API wymagają dowodu wdrożenia
implementacji oraz udanego testu integracyjnego, pochodzącego z zaufanego
workflow hosta, związanego z artefaktem i wykonaniem. **Attribution v1
nie produkuje jeszcze takiej atestacji; deklaracje "zintegrowałem API"
otrzymują `CLAIM_UNSUPPORTED`, nawet jeśli wykonano pojedynczy HTTP 200.**
To zamierzone zachowanie fail-closed.

Zwykłe zadania niezależne od źródeł zewnętrznych zachowują istniejącą
ścieżkę dowodową z aktywnym Attribution Gate; same liczby techniczne
nie są nazywane niepotwierdzonymi faktami zewnętrznymi.

## Granica bezpieczeństwa i egress
`callTool()` kontroluje tylko wywołania przez bramkę. **Nie blokuje** prób
`fetch`, `node:http`, `node:net`, `node:tls` ani procesów potomnych
wykonawcy. Pełna polityka "deny all egress except gateway" wymaga
izolacji OS/container/network na hoście (oddzielny sandbox/namespace,
egress firewall, dozwolone endpointy, audyt polityk). Nie wdrożono jej
w tej zmianie, dlatego Proof Receipt jawnie wskazuje
`egress_status: NOT_ENFORCED` i `signature_status: UNAVAILABLE`.
`VERIFIED` w v1 oznacza zgodność **obsługiwanych** twierdzeń z
zarejestrowanymi wywołaniami, nie bezpieczeństwo całego egress ani
prawdziwość świata zewnętrznego.

Ponieważ `ToolCallRecord.response` zawiera treść odpowiedzi, przed
produkcją potrzebne są reguły redakcji danych i retencji. SHA-256
jest hashem, a nie podpisem cyfrowym. Samowystarczalny i w całości
przepisany bundle może być spójnie podrobiony bez zewnętrznego anchoru.

## Replay
Runtime zapisuje `TOOL_CALL_STARTED`, `TOOL_CALL_COMPLETED` i
`CLAIM_ATTRIBUTION_CHECKED`. Replay używa danych tego wykonania:
twierdzenie → identyfikator/hash odpowiedzi albo brak źródła →
kod przyczyny → końcowy werdykt. Dla misji zakończonej sukcesem
`verifyCompletedMission` sprawdza również porządek wywołań i zdarzeń.

## Testy
`tests/source-attribution-22c.test.ts`:
- Raport 22°C i deklaracja integracji, bez wywołania API → `FAILED / CLAIM_UNSUPPORTED`.
- Faktyczne HTTP do lokalnego serwera, odpowiedź 22°C, raport 22°C → `VERIFIED`.
- Faktyczne HTTP 22°C, raport 25°C → `FAILED / CLAIM_VALUE_MISMATCH`.
- Zwykła aplikacja do zadań, raport z liczbami → `VERIFIED`.
- Pojedynczy HTTP 200 plus deklaracja zakończonej integracji → `FAILED / CLAIM_UNSUPPORTED`.

To nie stanowi testu izolacji sieciowej hosta.

## P0 — korekta false-positive w normalnych buildach
Od wersji naprawczej kontrola zewnętrznych twierdzeń pozostaje DEFAULT_ON
w aplikacjach API, Unified i MissionKernel. **Nie** stosujemy opt-out do
każdego builda: wygenerowana aplikacja może zawierać nieprawdziwe dane
o świecie zewnętrznym. Wewnętrzne, deterministyczne próby Intelligence
mogą korzystać z host-only opt-out; nie jest on zależny od użytkownika.

Parser nie odrzuca arbitralnych liczb bez kontekstu: CSS (np. 22px),
wersji (v2.0), liczby widoków oraz wartości opisanych wyraźnie jako
przykładowe. Nie traktuje też surowego wejścia do narzędzia crypto.sha256
jako twierdzenia wykonawcy. W dalszym ciągu rozpoznaje deklaracje
integracji API, aktualne temperatury w języku naturalnym i w kodzie
HTML/JS, znane pola strukturalne currentWeather/temperature oraz
podstawowe notowania walut/kryptowalut. Porównanie odpowiedzi z
runtime-owned Tool Gateway pozostaje wymagane przy takich twierdzeniach.
HTML/JS jest analizowany jako tekst, nie wykonywany na serwerze.

Skanowane są też jawne kolekcje wygenerowanych plików `files`/`artifacts` z rozszerzeniami HTML/JS/TS i polami `content`/`source`/`code`. Nie oznacza to analizy wszystkich możliwych formatów, archiwów ani dynamicznie generowanej treści.

Wspierana gramatyka jest **ograniczona**; nie stanowi uniwersalnego
parsera faktów ani bezpiecznego sandboxa. W szczególności semantycznie
równoważny kod dynamiczny albo wielojęzyczne sformułowanie poza tymi
wzorcami może wymagać odrębnej analizy. Brak wykrytego twierdzenia
oznacza jedynie "brak rozpoznanych twierdzeń", a nie kompletną walidację
faktyczną całego artefaktu. Status egress pozostaje NOT_ENFORCED.

Test regresyjny obejmuje:
- build przez MissionKernel/Delivery Lab z aktualną temperaturą 22°C
  w treści HTML i bez API → FAILED/CLAIM_UNSUPPORTED;
- to samo przy currentWeather.temperature_celsius=22 w JS → FAILED;
- zwykły HTML/JS z 22px, v2.0, 3 widokami i jawnie przykładową temperaturą
  → VERIFIED;
- dotychczasowe przypadki 22°C/25°C, bitcoina i forged tool evidence.

## Rozszerzone scenariusze regresji
- „Kurs bitcoina wynosi 70000 USD” bez wywołań i bez słów z dawnej listy aktywacyjnej: `FAILED / CLAIM_UNSUPPORTED`.
- Fałszywe `kind: tool_call` w evidence wykonawcy, a `tool_calls=[]`: `FAILED / CLAIM_UNSUPPORTED`; hash takiego evidence nie zmienia jego autorstwa.
- Próba przesłania opt-out przez `Mission.input` i `final_output`: ignorowana.
- Czysty build z liczbami: domyślnie nieotrzymujący VERIFIED dla niezwiązanych liczb, lecz `VERIFIED` po jawnym opt-out zaufanego hosta.
- Próba niezależnej weryfikacji opt-out bez potwierdzenia przez hosta: odrzucona.
