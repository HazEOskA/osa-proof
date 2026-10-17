# Domknięcie modelu i trwałego zapisu — 17.10.2026

Repo `HazEOskA/osa-proof`, jedna gałąź release i PR #16. Zakres nie dotyka odrębnej gałęzi Agent Trust Fabric ani prywatnego importu NeurOSA.

## Prawdziwy model

Pierwszy rzeczywisty test na Preview kodu ef8eed4: `exec_b2457490-e018-4a09-9de9-4cfefaf072cf`, NVIDIA `nvidia/nemotron-3-super-120b-a12b`, odpowiedź `chatcmpl-c093039d-48e3-4762-8336-f02b24d5214d`, tool_call `call-524603a9-8ec1-48b2-b496-79a6e9a2e293`. Status TOOL_EXECUTED, routing MODEL_TOOL_CALL, 9 zdarzeń i dwa materiały dowodowe. Rzeczywiste argumenty: tekst „OSA Proof v0.1.0”; SHA-256 `6b3754309dea732d2b0afbdcfe7dbc1c2be5e31d881db6c70773257488b1145d` zgodny z niezależnym obliczeniem.

Niezależny backendowy verifier: PASS, jeden execution_id w run/receipt/events, zmieniony dowód odrzucony. Nie użyto deterministycznego routera ani podmiany odpowiedzi. Udokumentowany przez NVIDIA endpoint jest bezpłatny; nie było płatnego fallbacku. Bieżąca zgoda „dokończ trzy kroki” pozwoliła wykonać wcześniej opisany ograniczony test. Dawna automatyczna odmowa nie jest już bieżącym blokerem tego pierwszego wykonania.

[Odpowiedź](../evidence/release-v0.1.0/finalization-three/nvidia-preview-attempt-1.json), [pełny bundle](../evidence/release-v0.1.0/finalization-three/model-bundle.json), [niezależna weryfikacja](../evidence/release-v0.1.0/finalization-three/independent-model-verification.json).

Drugi i ostatni dozwolony test uruchomiono przez rzeczywisty Czat floty agentów na Preview kodu `3f6ada3d99b8224e80506eca1020eb941455c424`: `exec_2b067264-0faf-4d82-b8a6-89b5e84978ff`, odpowiedź `chatcmpl-2f3d5879-ec5e-4bec-9698-107de1080a8b`, tool_call `call-7e87cb2f-9c2a-4c44-92f5-c34d9a415440`. Ten sam model, argumenty i poprawny SHA-256. Każdy nowy pusty kontekst 320/390/1440 odczytał bundle z Postgresa, zweryfikował go backendowo i niezależnie przez WebCrypto, odtworzył 9 zdarzeń i zachował wynik po odświeżeniu. Odtwarzanie nie wykonało kolejnego żądania modelowego. Próby klienta podszywające się pod modelowy dispatch, w tym `shell.exec`, zwróciły HTTP 403 przed transportem do modelu. [Odpowiedź modelu](../evidence/release-v0.1.0/finalization-three/nvidia-preview-attempt-2.json), [odbiór browser](../evidence/release-v0.1.0/finalization-three/model-browser-results.json), [testy negatywne](../evidence/release-v0.1.0/finalization-three/preview-negative.json).

Łącznie dwa bezpłatne wywołania na Preview, brak płatnego fallbacku. Test używał emulacji Androida, nie fizycznego telefonu. Dowód zachowuje pochodzenie odpowiedzi; receipt nie jest podpisem NVIDIA. Unified v2 nie zapieczętowuje pełnych payloadów Events.

## Rzeczywista trwałość

Supabase: nowy projekt `osa-proof`, ref `rzuhgklbuujvciargkwi`, eu-central-1, organizacja HazEOskA `qyzrygshsubybkyohsre`. Plan Free i koszt nowego projektu **0 miesięcznie** potwierdzone przez API. Pozostałych projektów nie zmieniano. Nie uruchomiono płatnego planu, VM, Azure deploymentu ani modeli płatnych.

Jedna prywatna tabela `osa_runtime_records` z RLS i bez uprawnień anon/authenticated. Wąski adapter danych `deploy/storage` uwierzytelnia każde żądanie podpisem Ed25519, wiążąc treść, namespace, scope i krótki czas ważności. Osobne klucze Preview i produkcji uniemożliwiają użycie podpisu Preview do namespace produkcyjnego. Klucze prywatne i klucz AES są wyłącznie sekretami serwera. Automatyczny service_role pozostaje w środowisku funkcji bazy; nie jest przekazywany do Vercel ani przeglądarki.

Zakres trwały: kompletne wykonania Unified (Team Graph/mission/run/Events/Evidence/ProofReceipt), Mission Kernel z CAS rewizji oraz szyfrowane prywatne połączenia API. `GET /api/unified/executions/:execution_id` odczytuje bundle i ponownie weryfikuje integralność. Czat potrafi pobrać go przez parametr `?execution_id=...`, zweryfikować niezależnie w przeglądarce i otworzyć istniejący Replay.

Zakres pozostający PROCESS_MEMORY: kolejki i rejestr workerów, szkic Buildera, polityki, pozostała konfiguracja i lokalna wiedza. Historia zwykłej rozmowy jest lokalna w przeglądarce. To jawnie ograniczona trwałość rdzenia, a nie obietnica trwałości każdego modułu lub prywatnego wieloużytkownikowego IAM. Legacy odczyt run z odzyskiwania listy obejmuje ostatnie 100 zapisów; odczyt po execution_id jest bezpośredni. Plan Free może wstrzymać nieaktywną bazę; awaria magazynu odrzuca zapis, bez ukrytego przejścia na pamięć procesu.

[Rzeczywiste kontrole](../evidence/release-v0.1.0/finalization-three/durable-live-results.json): odczyt po nowym procesie i nowej instancji API, rzeczywisty równoległy CAS (jeden zapis wygrywa, drugi 409), zaszyfrowany klucz odczytany w nowej instancji, odmowa obcego właściciela, odmowa bez podpisu i odmowa klucza Preview w produkcyjnym namespace. Znacznik testowy klucza nie był prawdziwym kluczem dostawcy i został usunięty. Test przechowuje rzeczywisty wcześniejszy bundle modelowy; nie twierdzi, że wykonał nową generację.

## Konfiguracja i cofnięcie

- `OSA_STORAGE_URL`: endpoint funkcji `osa-proof-storage` nowego projektu.
- `OSA_STORAGE_NAMESPACE`: `release-v0.1.0-preview` albo `production-v0.1.0`.
- `OSA_STORAGE_PRIVATE_KEY_B64`: osobny sekret podpisujący dla danego namespace.
- `OSA_CONNECTIONS_ENCRYPTION_KEY`: osobny 64-znakowy klucz szesnastkowy AES dla danego środowiska.

Najpierw skonfigurowano wyłącznie Preview gałęzi release. Wdrożenie produkcyjne i jego dokładny SHA są raportowane dopiero po zielonym CI i odbiorze w PR #16. Rollback kodu: poprzedni deployment dpl_72Zv7pX7D5dBUc19J4umiSKNzx7G / ef8eed4. Nie usuwać bazy ani rekordów przy cofnięciu aplikacji. Stary kod wraca do PROCESS_MEMORY i nie wykorzystuje nowego zapisu; powrót do nowego kodu z tymi samymi serwerowymi kluczami przywraca dostęp do danych. Zmiana/usunięcie klucza AES uniemożliwia odczyt prywatnych połączeń.

## Worker i cloud

Istniejący kod Azure/Worker Host pozostaje w tym samym repo. Vercel nadal nie ma `OSA_WORKER_BASE_URL` ani `OSA_WORKER_TOKEN`; lokalne środowisko nie ma Azure CLI/Docker ani dostępu do aktywnego hosta. Przykładowy adres w pliku env nie jest potwierdzonym hostem. Rzeczywiste kontenery zostały wcześniej potwierdzone w CI, z niezależną weryfikacją receipts.

Uruchomienie `deploy/azure-worker/deploy.sh` tworzy VM, sieć, dysk, Key Vault i budżet 40 jednostek waluty, który nie jest twardym limitem. Nie wykonano tego jako rzekomo bezpłatnego testu. Minimalny brakujący warunek to rzeczywisty URL istniejącego hosta i token ustawiony jako sekret serwera, albo osobne zatwierdzenie dokładnego provisioningu i kosztu. Do tego czasu produkcyjny Worker/Builder/cloud pozostaje GATED. Nie ogłaszamy pełnego wydania wszystkich trzech obszarów.
