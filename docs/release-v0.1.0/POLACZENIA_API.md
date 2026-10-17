# Połączenia API i profile — checkpoint 17.10.2026

Zakres: istniejący Czat floty agentów, globalne Zapytaj OSĘ i Sekrety w tym samym frameworku. Przywrócono domyślnego Jeffa, Hermesa i wybór OpenRoutera. Dodano serwerowe połączenia NVIDIA/OpenRouter/OpenAI/Anthropic oraz zgodnych publicznych API przez istniejące adaptery. OpenRouter nie jest zastępowany NVIDIA, a zapisany wybór dostawcy przeżywa odświeżenie.

## Dane i koszt

Frontend wysyła nowy klucz do własnego endpointu zapisu, po czym czyści pole. API odczytu zwraca wyłącznie metadane. AES-256-GCM wiąże zaszyfrowaną konfigurację z właścicielem i dostawcą. Właściciela identyfikuje losowe HttpOnly/SameSite=Strict cookie, w chmurze również Secure. Mutacja połączenia wymaga zgodnego originu. Klucz nie trafia do historii ani frontend storage.

Obecny Vercel bez trwałego magazynu używa PROCESS_MEMORY: maksymalnie godzina, utrata przy restarcie lub zmianie instancji. Zapis lokalny jest szyfrowany na dysku, testowany z nową instancją API i równoległymi zapisami. Opcjonalny adapter Postgres nie ma dowodu działania z rzeczywistą bazą. Próba podłączenia bezpłatnego Neon nie utworzyła zasobu: organizacją zarządza Vercel, a dostępna integracja odmówiła tej operacji. Nie provisionowano płatnej bazy.

NVIDIA w open nie wymaga już sesji operatora. Bez Redis limit jest lokalny 3/min i 30/h na instancję/klucz. Dokładny model `nvidia/nemotron-3-super-120b-a12b` jest wymieniony jako bezpłatny endpoint w oficjalnym katalogu NVIDIA; dostęp konta potwierdza dopiero rzeczywiste wywołanie. `openrouter/free` i warianty `:free` nie mają płatnego fallbacku. Pozostałe prywatne modele wymagają jawnej zgody na rozliczenie własnego konta. Ta zgoda w produkcie nie jest dowodem wykonania ani zgodą na nasze testy płatnych modeli.

## Dowody lokalne

- [Testy backendu](../evidence/release-v0.1.0/api-providers-2026-10-17/tests.txt): 251 łącznie, 247 PASS, 0 FAIL, 4 SKIP; `npm test` zawiera build backendu.
- [Worker Host](../evidence/release-v0.1.0/api-providers-2026-10-17/worker-build.txt) i [dashboard](../evidence/release-v0.1.0/api-providers-2026-10-17/dashboard-build.txt): poprawne buildy.
- `tests/provider-connections.test.ts`: rzeczywisty lokalny szyfrowany zapis, restart API, osobne cookies/właściciele, scope, integralność, współbieżny zapis; odmowa originu, SSRF i zmiany stałego endpointu; kontrolowany HTTP dla tekstu/historii oraz odmowa kosztu i narzędzi przed transportem.
- [Kontrakty UI 320/390/1440](../evidence/release-v0.1.0/api-providers-2026-10-17/ui-contracts.txt): Jeff, Hermes, OpenRouter po odświeżeniu, formularz API, czyszczenie pola, brak klucza w localStorage/sessionStorage, brak poziomego przepełnienia. Metadane/zapis/odpowiedzi dostawców są kontrolowane — nie stanowią dowodu dostawcy.
- [Natywny browser E2E](../evidence/release-v0.1.0/api-providers-2026-10-17/native-results.json): rzeczywisty lokalny Runtime, oba weryfikatory, Evidence/receipt, Replay do ostatniego zdarzenia, odświeżenie i odmowa zmienionego dowodu; bez podmiany transportu i bez generacji modelowej.

Natywne identyfikatory lokalne: `exec_403dc4ac-b179-4476-8f67-3734fb9d4103` (320), `exec_820f3e09-4634-4f4a-af5d-f543950f5d7e` (390), `exec_cd64c010-43a6-42f0-aee6-41004512fee2` (1440). To SHA-256 wybrane poleceniem użytkownika, nie modelowe tool_calls.

## Nieprzypisane sukcesy

Automatyczna kontrola odrzuciła próbę rzeczywistego NVIDIA z `execute_tools=true` w produkcji z powodu braku osobnej zgody na koszt i zakres. Brak zapisanego wyniku lub execution_id tej próby. Nie ponawiano jej innym kanałem, nie zaliczamy jej jako PASS. Nie wywołano rzeczywistych OpenAI/Anthropic/OpenRouter ani płatnego zamiennika.

Publiczny modelowy ONE FLOW, trwały backend chmurowy, podłączony execution host cloud i NeurOSA nadal wymagają rzeczywistego dowodu. CI i wdrożenie dokładnego SHA są zapisywane po publikacji w [PR #16](https://github.com/HazEOskA/osa-proof/pull/16). Instrukcja i rollback: [OPERATOR.md](OPERATOR.md). Formalny release pozostaje BLOCKED.
