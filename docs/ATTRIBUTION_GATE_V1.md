# Attribution Gate v1 — kontrakt i granice dowodowe

## Zakres
Brama w `OsaRuntime` rejestruje wykonane przez `context.callTool()` wywołania
narzędzi hosta. Wpis `ToolCallRecord` obejmuje `execution_id`, `operation_id`,
`agent_id`, `tool_ref`, hash kanonicznego żądania, odpowiedź oraz hash
kanonicznej odpowiedzi. Wynik i `tool_call_root` są związane z Proof Receipt.
Agent nie może wystawić `ToolCallRecord` przez pole `evidence`.

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
ścieżkę dowodową i nie wymagają cytowania liczb związanych z projektem.

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
