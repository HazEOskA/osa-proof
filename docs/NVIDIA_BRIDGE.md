# Most NVIDIA w scenie World

W scenie kliknij NVIDIA, następnie Models. Formularz wysyła pojedynczy prompt do modelu na serwerach NVIDIA; pozostałe kategorie prowadzą do katalogów i instrukcji dostawcy.

Konfiguracja serwera:

```dotenv
NVIDIA_API_KEY=klucz_dostawcy
# Opcjonalnie: model dostępny dla tego klucza
NVIDIA_MODEL=nvidia/nemotron-3-super-120b-a12b
```

Klucz nie używa prefiksu VITE_ i nie trafia do przeglądarki. GET /api/nvidia/status zwraca wyłącznie informację o konfiguracji i model. POST /api/nvidia/chat przyjmuje JSON {"prompt":"..."}; oba endpointy stosują istniejący tryb sesji OSA. W trybie open API jest dostępne bez logowania, zgodnie z konfiguracją podglądu repozytorium; przed publicznym udostępnieniem produkcji należy użyć istniejącego trybu session.

Wywołanie: https://integrate.api.nvidia.com/v1/chat/completions, bez streamingu, maksymalnie 1024 tokeny odpowiedzi, 8000 znaków promptu, limit żądania 40000 bajtów, timeout dostawcy 25 sekund. Nie ma automatycznych retry ani fikcyjnej odpowiedzi przy braku klucza. Błędy dostawcy są sanitowane; treść błędu nie zawiera jego surowego body ani klucza.

Odpowiedź zawiera model, tekst, ID żądania, ID dostawcy (jeśli dostępne) i czas. Status PROVIDER_RESPONSE oznacza otrzymaną odpowiedź API, nie kryptograficzny proof ani wykonanie operacji przez agenta.

Dokumentacja dostawcy: https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-super-120b-a12b-infer

Ta zmiana nie wdraża aplikacji, nie zmienia ENV na Vercel i nie uruchamia GPU. Testy używają kontrolowanego dostawcy; test live wymaga klucza w środowisku docelowym.
