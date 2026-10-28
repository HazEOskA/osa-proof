# Most NVIDIA w scenie World

W scenie World kliknij przycisk „NVIDIA · modele i API” (lub NVIDIA, następnie Models). Formularz wysyła pojedynczy prompt do modelu na serwerach NVIDIA; pozostałe kategorie prowadzą do katalogów i instrukcji dostawcy.

Konfiguracja serwera:

```dotenv
NVIDIA_API_KEY=klucz_dostawcy
# Opcjonalnie: model dostępny dla tego klucza
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
```

Klucz serwera nie używa prefiksu VITE_ i nie trafia do przeglądarki. Własny klucz wpisany w panelu jest przechowywany wyłącznie w stanie formularza do zamknięcia panelu; trafia do serwera tylko z wywołaniem rozmowy i nie zmienia konfiguracji innych użytkowników. Nie jest zapisywany w localStorage ani bazie. GET /api/nvidia/status zwraca wyłącznie informację o konfiguracji i model. POST /api/nvidia/chat przyjmuje JSON {"prompt":"...", "model":"dostawca/model", "apiKey":"opcjonalny-własny-klucz"}; oba endpointy stosują istniejący tryb sesji OSA. W trybie open API jest dostępne bez logowania, zgodnie z konfiguracją podglądu repozytorium; przed publicznym udostępnieniem produkcji należy użyć istniejącego trybu session.

Wywołanie: https://integrate.api.nvidia.com/v1/chat/completions, bez streamingu, maksymalnie 1024 tokeny odpowiedzi, 8000 znaków promptu, limit żądania 40000 bajtów, timeout dostawcy **45 sekund** w aktualnej gałęzi `fix/osa-proof-neurosa-protected-preview-20261028` (oddzielne kody `NVIDIA_TIMEOUT` i `NVIDIA_UNAVAILABLE`). Nie ma automatycznych retry ani fikcyjnej odpowiedzi przy braku klucza. Błędy dostawcy są sanitowane; treść błędu nie zawiera jego surowego body ani klucza.

Odpowiedź zawiera model, tekst, ID żądania, ID dostawcy (jeśli dostępne) i czas. Status PROVIDER_RESPONSE oznacza otrzymaną odpowiedź API, nie kryptograficzny proof ani wykonanie operacji przez agenta.

Dokumentacja dostawcy: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer

Ta zmiana nie wdraża aplikacji, nie zmienia ENV na Vercel i nie uruchamia GPU. Testy używają kontrolowanego dostawcy; test live wymaga klucza w środowisku docelowym.

## Status chronionego Preview (28.10.2026)

Na gałęzi testowej `NVIDIA_MODEL` jest skonfigurowany **tylko dla Preview** jako `nvidia/nemotron-3.5-lightning-30b-a3b`. Kod czatu wyłącza przedłużone rozumowanie dla tego identyfikatora przez `chat_template_kwargs.enable_thinking=false`. Nie jest to zmiana domyślnego modelu w kodzie źródłowym, produkcji ani gwarancja czasu odpowiedzi. Po błędach 404 i timeout operator zaobserwował działającą odpowiedź w UI. Test regresyjny całego bieżącego SHA nie został niezależnie powtórzony.

**Uwaga:** tryb **Utwórz artefakt** korzysta z osobnego `OSA_DELIVERY_MODEL`; nie zakładaj, że ma ten sam identyfikator co `NVIDIA_MODEL`. Opis: [CHAT_ARTIFACT_FLOW.md](./CHAT_ARTIFACT_FLOW.md).
