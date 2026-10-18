# NeurOSA w OSA Proof — Preview bez logowania

## Tryb bez logowania (18.10.2026)

Gałąź `codex/neurosa-chat-memory`: usunięto integrację GitHub OAuth z aplikacji, przyciski logowania/wylogowania i sesje cookie GitHub. Czat floty agentów i Runtime w Preview korzystają z istniejącego `OSA_AUTH_MODE=open`, bez konta GitHub i dodatkowych tokenów operatora.

**Vercel Deployment Protection (SSO) nie został wyłączony.** To odrębna ochrona infrastruktury, poza aplikacją.

**Prywatna NeurOSA jest tymczasowo odłączona od Preview.** API Vercel nie montuje adaptera pamięci w środowisku Preview; operacje prywatne nie są dostępne anonimowo. Konfiguracja sekretów Vercel nie jest modyfikowana. Nie podłączaj prywatnej NeurOSA do anonimowego trybu open — wymaga osobnego bezpiecznego modelu dostępu.

Lokalna historia czatu jest przechowywana w localStorage użytkownika, bez synchronizacji z NeurOSA. OSA Runtime i `/unified/execute` oraz `/unified/verify` wciąż działają bez logowania aplikacyjnego. Brak weryfikacji LIVE pamięci lub trwałości po restarcie.

## Zachowany zakres

- `MemoryService`, sprawdzanie ledger, scope, dowody i testy kontraktowe pozostają w repo do przyszłej integracji.
- Podstawowy interfejs sesyjny w pozostałych środowiskach nie jest usuwany, aby nie zmienić niezwiązanych przepływów.
- Produkcja i główna gałąź nie są wdrażane ani zmieniane.
