# Istniejący OSA Worker Host na Azure

Kod workera, sandboxa Docker i adaptera Azure znajduje się w tym samym `HazEOskA/osa-proof`. Skrypt nie jest dowodem, że host już działa. Gotowość wymaga rzeczywistego wykonania i weryfikacji dowodu.

## Naprawione połączenie konfiguracji

- Bootstrap pobiera gałąź `release/osa-proof-v0.1.0`, przekazuje organizację i projekt wymagane przez Compose oraz zapisuje `.env` z uprawnieniami 0600.
- Brak scope i nieprawidłowy token zatrzymują start przed instalacją pakietów. Plik env jest parsowany jako dane; nie jest wykonywany przez shell.
- Ponowne uruchomienie zachowuje istniejący token Key Vault. Rotacja nie jest ukrytym skutkiem redeployu.
- Nowy sandbox domyślnie ma sieć `none`. Włączenie egressu wymaga jawnego ustawienia hosta dla zaakceptowanego zadania.
- Health potwierdza osiągalność procesu. Nie zalicza uruchomienia kontenera ani builda.

## Wymagane środowisko

Uruchomienie skryptu wymaga zalogowanego Azure CLI/Cloud Shell, właściwej subskrypcji i scope:

```bash
export OSA_WORKER_ORGANIZATION_ID=org_dev_local
export OSA_WORKER_PROJECT_ID=osa-proof
export OSA_WORKER_BRANCH=release/osa-proof-v0.1.0
```

Dla już istniejącego workera potrzebne są jego rzeczywisty adres i bezpiecznie skonfigurowany token. Nie wysyłaj tokenu do czatu ani issue. Przykładowy plik kontrolny: [control-plane.env.example](../worker/control-plane.env.example).

## Nowy provisioning: koszt i zakres

`deploy.sh` tworzy RG, budżet, sieć, publiczny adres, VM, Managed Identity, Key Vault, uprawnienia i harmonogram wyłączenia. Nie należy go uruchamiać jako nieszkodliwego health checku. Wymagana jest osobna akceptacja kosztu i tego zakresu.

Skrypt wymaga `subscriptionPolicies.spendingLimit=On`. Domyślny budżet RG to 40 jednostek waluty rozliczeniowej; budżet generuje alerty, nie stanowi twardego limitu wydatków. VM: pula 2 vCPU / 8 GB, bez automatycznego zwiększania rozmiaru. Regiony: northeurope, westeurope, swedencentral, germanywestcentral, francecentral; jawne `OSA_AZURE_LOCATION` wyłącza fallback. Wyłączenie domyślnie 01:00 UTC nie usuwa opłat za wszystkie zasoby.

Dopiero po zaakceptowaniu konkretnego zakresu operator może wykonać:

```bash
bash deploy/azure-worker/deploy.sh
```

Nie uruchomiono tego provisioningu w ramach obecnego odbioru. Azure CLI i aktywny host nie są dostępne w lokalnym środowisku pracy.

## Rzeczywista weryfikacja

Istniejący CI uruchamia `OSA_LOCAL_DOCKER_TEST=1` dla `platform-v05.test` i `worker-docker-live.test`. Obejmuje kontenery, Worker Host HTTP, RemoteWorkspaceProvider, scope, odmowę zapisu poza workspace, Runtime, receipt i cleanup. Dowody są artefaktem `osa-worker-docker-proof` bieżącego CI. To dowód wykonania na runnerze CI; nie oznacza wdrożenia Azure, pushu obrazu do registry ani wywołania modelu.
