# Dokumentacja OSA Proof — indeks

**Produkt:** OSA Proof · jeden framework i control plane. **Bieżący kandydat:** v0.1.0, **BLOCKED**. Numer wersji w `package.json` nie oznacza wydania. Nie interpretuj stanu deploymentu Vercel `READY` jako akceptacji całego release gate.

## Zacznij tutaj

| Potrzeba | Dokument | Źródło prawdy |
| --- | --- | --- |
| Co działa, co jest GATED/BLOCKED? | [Macierz możliwości](release-v0.1.0/MACIERZ.md) | Statusy poszczególnych funkcji z granicami dowodów |
| Co blokuje formalne wydanie? | [Bramki v0.1.0](release-v0.1.0/BRAMKI.md) | Warunki odbioru, nie plan nowych frameworków |
| Dodatkowy przegląd kodu i środowiska | [Audyt 17.10.2026](release-v0.1.0/AUDYT_DODATKOWY_2026-10-17.md) | Priorytety bezpieczeństwa, produkcja, dowody |
| Jak uruchomić i testować? | [Instrukcja operatora](release-v0.1.0/OPERATOR.md) | Konfiguracja Preview, modelu, bezpieczeństwo i limity |
| Co jest faktycznie wdrożone pod stałym adresem? | [Odbiór produkcyjny](release-v0.1.0/WDROZENIE_PRODUKCJA.md) | Środowisko testowego odbioru ≠ formalne wydanie |
| Jakie testy i execution_id? | [Weryfikacja](release-v0.1.0/WERYFIKACJA.md) | Historia testów z rozróżnieniem SHA i providerów |
| Co wejdzie do wydania? | [Release notes — projekt](release-v0.1.0/RELEASE_NOTES.md) | Plan publikacji, a nie gotowy GitHub Release |
| Zmiany w wersjach | [CHANGELOG](../CHANGELOG.md) | v0.1.0 nadal niewydane |

## Architektura i implementacja

- [Produkt i warstwy](PRODUCT_CONTRACT.md) — Academy, Builder/Core, Regulated.
- [Granice warstw](LAYER_BOUNDARIES.md), [architektura backendu](BACKEND_ARCHITECTURE_LOCK_V1.md), [Team Graph](TEAM_GRAPH_CONTRACT_V1.md).
- [Mission Kernel](MISSION_KERNEL_V1.md), [Unified Runtime](OSA_UNIFIED_RUNTIME_V1.md) i [raport P0](OSA_UNIFIED_RUNTIME_V1_P0.md).
- [Most NVIDIA](NVIDIA_BRIDGE.md) — provider, narzędzia modelu i ograniczenia.
- [Proof Protocol V1](PROOF_PROTOCOL_V1.md) i [V2](PROOF_PROTOCOL_V2.md) — weryfikacja, integralność i semantyka receipt.
- [Builder](NATIVE_BUILDER_V0.1.md), [Worker Host](OSA_WORKER_HOST_V0.1.md), [Workspace Provider](WORKSPACE_PROVIDER_V0.1.md).
- [Uruchomienie istniejącego hosta i granice dowodu cloud](../deploy/azure-worker/README.md) — wymagany scope, poprawiony bootstrap i rzeczywisty test Docker w CI.
- [NeurOSA S2](NEUROSA_BRAIN_S2.md) i [plan aktywacji pamięci](NEXT_STEP_MEMORY_ACTIVATION.md) — **nie** oznaczają uruchomionej pamięci.
- [Intelligence Layer](INTELLIGENCE_LAYER_V1.md), [dashboard](DASHBOARD_INTEGRATION.md).

**Kolejność autorytetu dokumentów:** rzeczywisty kod i odczyt środowiska konkretnego SHA → bieżąca [WERYFIKACJA](release-v0.1.0/WERYFIKACJA.md) i [AUDYT](release-v0.1.0/AUDYT_DODATKOWY_2026-10-17.md) → [BRAMKI](release-v0.1.0/BRAMKI.md) → [MACIERZ](release-v0.1.0/MACIERZ.md). Starsze dokumenty pod `docs/` zachowano dla historii decyzji; ich `„bez merge/deploy”` odnosi się do ówczesnego checkpointu.

## Zasady interpretacji dowodów

- **VERIFIED** = jawnie opisany zakres dowodu, nie gotowość wszystkich integracji.
- **GATED** = implementacja może istnieć, ale bieżąca konfiguracja/polityka uniemożliwia wykonanie.
- **BLOCKED** = niezaliczona obowiązkowa bramka, bez zastępowania mockami.
- **CLAIM ≠ PROOF:** deklaracja modelu nie jest wykonaniem, a integralność receipt nie stanowi zewnętrznej atestacji dostawcy.
- **Preview/Production READY ≠ RELEASED.** Merge, tag i GitHub Release są odrębnymi, autoryzowanymi działaniami.
