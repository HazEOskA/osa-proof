# Historia zmian

## 0.1.0 — kandydat, niewydany

Status wydania: **BLOCKED**. Nie utworzono tagu ani GitHub Release.

- Włączono zakres globalnego przewodnika „Zapytaj OSĘ” z PR #15, zachowując osobny Czat floty agentów i istniejący polski interfejs.
- Na życzenie operatora Preview i produkcja Vercel w jawnym `OSA_AUTH_MODE=open` otwierają panel bez obowiązkowego logowania. Tryb session, autoryzacja wywołań NVIDIA i ograniczenia kosztów pozostają w kodzie.
- Klucz NVIDIA pozostał wyłącznie na serwerze; dodano politykę bezpłatnego modelu z terminem ważności i współdzielony limit żądań, bez tworzenia infrastruktury.
- Dodano transport walidowanych modelowych tool_calls do istniejącego Runtime dla odczytowego SHA-256. Testy z symulowanym dostawcą nie są dowodem działania NVIDIA.
- Dodano weryfikowany lokalny eksport wyniku po odświeżeniu oraz jawne ograniczenia PROCESS_MEMORY.
- Dodano testy odmów dostępu, zakresów, kosztów, transportu i integralności oraz kompilację worker hosta w CI.

Bramki, dowody i ograniczenia: [docs/release-v0.1.0/BRAMKI.md](docs/release-v0.1.0/BRAMKI.md).
