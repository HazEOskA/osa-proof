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

Dla domyślnego trybu wartości liczbowe poza znaną gramatyką temperatury
bez żadnego rzeczywistego źródła są odrzucane
`CLAIM_UNSUPPORTED`; obecność niezwiązanej odpowiedzi narzędzia
nie wystarczy do ich potwierdzenia. Jeśli bramka nie wykrywa
żadnego faktu źródłowego, nie tworzy sztucznego twierdzenia do
odrzucenia. Nierozpoznane zdania bez liczb i wzorców operacji
mogą pozostawać poza pokryciem — analiza języka jest nadal
heurystyką v1, a nie gwarancją pełnej detekcji.

Dla misji z faktami zewnętrznymi verifier v1 deterministycznie analizuje
`report`, `answer`, `message`, `text`, `content`, `artifact.content`
i `temperature_celsius`. Liczby z oznaczeniem °C porównuje z polami
`temperature`, `temp`, `temperature_celsius`, `temp_celsius`, `celsius`
w odpowiedzi narzędzia. Niezgodność: `CLAIM_VALUE_MISMATCH`. Brak
odpowiedzi: `CLAIM_UNSUPPORTED`. Pozostałe liczby i nierozpoznane zdania
w raporcie o faktach zewnętrznych nie otrzymują `VERIFIED`:
`CLAIM_COVERAGE_INCOMPLETE`. Jest to **ograniczona heurystyka v1**,
nie dowód kompletnego rozumienia języka naturalnego.

Sformułowania o wykonaniu integracji API wymagają dowodu wdrożenia
implementacji oraz udanego testu integracyjnego, pochodzącego z zaufanego
workflow hosta, związanego z artefaktem i wykonaniem. **Attribution v1
nie produkuje jeszcze takiej atestacji; deklaracje "zintegrowałem API"
otrzymują `CLAIM_UNSUPPORTED`, nawet jeśli wykonano pojedynczy HTTP 200.**
To zamierzone zachowanie fail-closed.

Zwykłe zadania niezależne od źródeł zewnętrznych zachowują istniejącą
ścieżkę dowodową po **jawnym opt-out z zaufanego hosta**. Bez opt-out
domyślna bramka może odrzucać również liczby techniczne, które
nie zostały sklasyfikowane jako elementy wyłącznie kreatywnego builda.

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

## Rozszerzone scenariusze regresji
- „Kurs bitcoina wynosi 70000 USD” bez wywołań i bez słów z dawnej listy aktywacyjnej: `FAILED / CLAIM_UNSUPPORTED`.
- Fałszywe `kind: tool_call` w evidence wykonawcy, a `tool_calls=[]`: `FAILED / CLAIM_UNSUPPORTED`; hash takiego evidence nie zmienia jego autorstwa.
- Próba przesłania opt-out przez `Mission.input` i `final_output`: ignorowana.
- Czysty build z liczbami: domyślnie nieotrzymujący VERIFIED dla niezwiązanych liczb, lecz `VERIFIED` po jawnym opt-out zaufanego hosta.
- Próba niezależnej weryfikacji opt-out bez potwierdzenia przez hosta: odrzucona.
