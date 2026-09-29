# OSA brand lock

Źródło: dwa rendery OSA FRAMEWORKS dostarczone przez Bartka 2026-09-29 (sidebar, siatka "ICON SYSTEM · UNIFIED DESIGN", kafelki kart, "LOGO VARIANTS").
Ikony wycięte 1:1, tło usunięte po luminancji (alfa), bez przerysowywania.

Zasady:
- Jedno źródło: `src/brand/icons.ts`. Komponenty biorą ikonę po kluczu, nigdy po ścieżce pliku.
- Znak aplikacji: `LOGO.wings` (pszczoła ze skrzydłami). Rail i favicon: to samo.
- Ikona Repos z siatki to Octocat (znak GitHuba) — nie używamy. Repos = `</>`.
- Rozdzielczość źródeł: sidebar ~38 px, siatka ~42 px, karty ~58 px, logo ~140 px. Powyżej 40 px CSS używaj kart albo logo; wektory do uzupełnienia, gdy będą.
