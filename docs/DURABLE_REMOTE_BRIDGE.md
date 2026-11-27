# Produkcyjny Durable Bridge

Vercel nie zapisuje kolejki w Lambda i nie uruchamia w niej workera. Autoryzowany gateway przekazuje wyłącznie trasy Durable przez HTTPS do dedykowanego adaptera na 127.0.0.1:8791. Adapter wykorzystuje istniejący FileDurableJobStore oraz niezależny worker. Nie wystawia dashboardu, Ollama, workspace API ani NeurOSA.

Konfiguracja serwerowa (nigdy VITE_*):
- OSA_DURABLE_REMOTE_URL: adres HTTPS uwierzytelnionego adaptera.
- OSA_DURABLE_REMOTE_TOKEN: losowy sekret minimum 32 znaki.
- OSA_DURABLE_REMOTE_ORGANIZATION_ID, OSA_DURABLE_REMOTE_IDENTITY_ID, OSA_DURABLE_REMOTE_PROJECT_ID: jeden konkretny, zweryfikowany właściciel.
- Lokalnie: OSA_DURABLE_DIR wskazuje dokładnie ten sam trwały katalog co worker.
- OSA_DURABLE_BRIDGE_PORT: domyślnie 8791; nasłuch wyłącznie na loopback.

Uruchomienie: npm run build, następnie npm run start:durable-bridge.
Sekret przechowuj poza repozytorium i przekazuj do procesu przez środowisko.
Tunel HTTPS musi prowadzić wyłącznie do adaptera, bez przekierowania dashboardu.
Brak konfiguracji, utrata łączności lub brak heartbeat workera nie może powodować przyjęcia zadania jako potwierdzonego.

Bramki: zweryfikowana sesja owner/operator, dokładne scope, same-origin POST, token Bearer i digest scope, limit rozmiaru żądań/odpowiedzi, brak redirectów, timeout, idempotency i zachowane dowody. Pamięć remember=true nadal nie należy do Durable. Nie zmieniono konfiguracji NeurOSA.

Odbiór produkcji wymaga zalogowania, /api/durable/status (enabled=true, worker=HEALTHY), zadania z czatu, zamknięcia karty po przyjęciu, odzyskania wyniku i sprawdzenia ProofReceipt. Sam test adaptera nie jest odbiorem produkcji.
