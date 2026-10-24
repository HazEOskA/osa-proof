# Czat → model → artefakt → dowody

W czacie floty wybierz **Utwórz artefakt**, format **Aplikacja HTML** albo **Dokument Markdown**, wpisz cel i wyślij.

1. API przyjmuje cel, conversation_id i execution_id; sprawdza sesję, origin, bezpłatny dostęp i limit wywołań.
2. Istniejący MissionKernel prowadzi dziesięć ról Delivery Lab. Zdarzenia zapisane przez kernel są wysyłane SSE do czatu; nie są symulowaną animacją ani prywatnym rozumowaniem modelu.
3. Plan zakresu jest natywny. Rola producer wywołuje rzeczywisty model NVIDIA i otrzymuje pełny plik; nie ma fallbacku do szablonu przy braku modelu lub błędzie.
4. Kolejne role kontrolują bajty, SHA-256, strukturę, składnię skryptów i deklarowane bramki. Sandbox/deploy nie są uruchamiane ani deklarowane.
5. Kernel pieczętuje evidence, ProofReceipt i MissionReceipt. Przeglądarka niezależnie przelicza digest bundle, artefaktu i proof; następnie otwiera trace/replay w istniejących widokach.
6. Dostępne są pliki: artefakt, kompletny bundle JSON, evidence JSON, trace JSONL, ProofReceipt JSON i samodzielny replay HTML. Replay offline przelicza integralność i odtwarza zapisane zdarzenia, nie ponawia narzędzi.

## Konfiguracja

- Istniejący serwerowy `NVIDIA_API_KEY`.
- `OSA_NVIDIA_FREE_TIER_ACK=true` — wymagane potwierdzenie bezpłatnego dostępu; płatne użycie nie jest odblokowywane.
- `OSA_DELIVERY_MODEL` — jawny model dla tego przepływu, domyślnie `openai/gpt-oss-20b`. To osobna konfiguracja generowania artefaktu, bez cichego fallbacku i bez zmiany modelu dotychczasowej rozmowy.
- Status: GET `/chat/delivery/status`; wykonanie: POST `/chat/delivery` (w Vercel prefiks `/api`).

## Granice dowodu

Model może oddać wadliwy kod lub niepełny dokument. Pozytywna weryfikacja potwierdza integralność, przebieg i opisane kontrole, nie prawdziwość treści, bezpieczeństwo dowolnego kodu ani spełnienie każdego wymagania użytkownika. Podgląd HTML ma opaque iframe bez same-origin i CSP blokującą sieć.

Przepływ korzysta z istniejącego MissionStore. Cache ogrodzenia execution_id jest per instancja, bez gwarancji globalnego exactly-once. Identyczne ponowienie zakończonej operacji w tej samej instancji zwraca wcześniejszy bundle; konflikt treści, aktywne lub niepewne wykonanie nie jest automatycznie ponawiane. Po zerwaniu połączenia klient pokazuje brak potwierdzenia i zachowuje identyfikator w błędzie. Trwałym eksportem jest pobrany bundle; przeglądarka zachowuje wynik w historii lokalnej, o ile storage jest dostępny. Ten slice nie deklaruje trwałej pamięci NeurOSA ani zdalnego sandboxa.

## Walidacja

`npm test` obejmuje rzeczywisty lokalny HTTP/SSE, obserwację postępu przed zakończeniem generowania, powiązania identyfikatorów, odmowy i ogrodzenie ponowień. Kontrolowany generator istnieje wyłącznie w testach, nie jest fallbackiem produkcyjnym.

`node scripts/test-chat-delivery-browser.cjs` sprawdza Android/desktop: prompt, postęp, runtime, sześć pobrań i hashe, funkcjonalny artefakt w izolowanym iframe, replay, offline HTML oraz przywrócenie po odświeżeniu. Domyślnie testuje transport kontrolowany i rzeczywisty runtime; osobny live test modelu wymaga wdrożenia z potwierdzoną bezpłatną konfiguracją. Nie należy mylić tych dwóch dowodów.
