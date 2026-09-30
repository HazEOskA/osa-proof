# OSA v0.3 / v0.4 / v0.5 — lokalny przegląd przed deploymentem

Zakres uzgodniony: v0.3 = S3, v0.4 = S4, v0.5 = S5. Branch do przeglądu: `feature/platform-v03-v05-review`. Deployment pozostaje zatrzymany; Vercel Git deployment jest wyłączony dla tego brancha. To inkrement do istniejącego MissionKernel/OsaRuntime, nie drugi framework.

## Mapa zmian i źródła reuse

| Slice | Moduł / symbol | Działanie |
|---|---|---|
| v0.3 | `packages/control/src/index.ts:JobQueue` → `packages/fleet/src/index.ts:FleetQueue` | Jedna kolejka, scoped placement, capacity/concurrency, heartbeat, draining, TTL, generation/token fencing, recovery i rekomendacja skali. |
| v0.3 | `packages/workspace-runtime/src/*`, `apps/worker/src/*` | Przeniesione z `origin/feature/azure-worker-deploy-v0.1`; Docker i remote worker, create/exec/write/ports/stop. |
| v0.3 | `sandboxExecutor`, `PlatformControlPlane.runOne` | Istniejące AgentExecutor/ExecutorRegistry/MissionKernel; osobny sandbox per task, cleanup przed sukcesem, receipt jako istniejące evidence. |
| v0.4 | `CapabilityCatalog` | Wersjonowany opis capability i grant scope, w tym metadata MCP/skill/plugin/API/cloud. Opakowuje działające executory, nie przepisuje adapterów. |
| v0.4 | `McpHttpIntegration`, `registerIntegrationBundle` | MCP HTTP JSON initialize/list/call; atomowe manifesty skill/plugin oparte na istniejących executorach, bez eval/install. |
| v0.4 | `benchmarkFromExperiment`, `BenchmarkStore.select` | Reuse Experiments/datasets/evaluators/proof. Kategorie benchmarków, digest, quality/reliability; routing tylko porównywalnych i świeżych wyników w allowliście. |
| v0.5 | `packages/deployment/src/index.ts` | Build/test/export → BuildReceipt; neutralny CloudProvider/CloudRegistry; plan z pinami build/image; niezależna walidacja live. |
| v0.5 | `DockerImagePublisher` | Zaufany host buduje stały Dockerfile z jednego artefaktu JS; scoped grant push; inspekcja digestu registry; ImageReceipt. Agent nie dostaje socketu Dockera. |
| v0.5 | `AzureContainerAppsProvider` | ARM deploy/status/logs/scale/secrets/metrics/destroy; scope RG/subscription, grant planu, kontrola właściciela istniejącego zasobu. |
| v0.5 | `applicationDeploymentExecutor` | Jawna kompozycja publikacji/deploymentu/live verification przez istniejący AgentExecutor. NIE zarejestrowana w preview. |
| Proof | `MissionPolicy.required_receipts`, `verifyMissionExecution` | COMPLETED dla mission z live gate wymaga zgodnych receipts build→image→deployment→live verification. |
| Przegląd | `/platform/status`, `/platform/deployments/review`, dashboard Deployments | Session gate, tenant scope, wyłącznie przegląd, zero wywołań cloud. |

Istniejący `DeploymentStore` nadal przypina TeamGraph. Deployment aplikacji ma oddzielny kontrakt `DeploymentPlan`; nie mieszamy semantyki tych operacji.

## Lokalny start

```bash
npm run build
HOST=127.0.0.1 PORT=3111 OSA_EXECUTION_MODE=fixture OSA_AUTH_MODE=open npm start
```

Tryb execution jest walidowany w `apps/api/src/server.ts:loadExecutionMode`. Fixture jest jawnie oznaczony i nie stanowi dowodu wykonania w sandboxie.

Dashboard: przygotowany przez `node scripts/build-dashboard.cjs`; Vite używa `/api` proxy na `127.0.0.1:3111`:

```bash
cd .osa-dashboard-src
npm run dev -- --host 127.0.0.1
```

W Deployments jest panel stanu platformy v0.3–v0.5. Brak zarejestrowanego cloud providera jest pokazany jako brak konfiguracji. Nie ma przycisku wykonującego cloud deploy.

## Test z prawdziwym execution plane

```bash
npm test
OSA_REVIEW_DIR=/workspace/osa-proof/.osa-local-review npm run test:platform:local
```

Test opt-in używa przypiętego obrazu `node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402`. Wymaga lokalnego Dockera i dostępnego obrazu. Test tworzy dwa krótkotrwałe kontenery, uruchamia Node syntax check i node:test, eksportuje artefakt, niszczy oba kontenery i sprawdza MissionReceipt. Opcjonalny katalog review zawiera rzeczywisty record/receipts, bez kluczy i tokenów.

Przetestowana ścieżka: Mission → native Brain → pinned linear graph → Fleet lease → Agent 1 / sandbox 1 → source handoff → Agent 2 / sandbox 2 → build/test/export → cleanup → existing ProofVerifier → COMPLETED → MissionReceipt / timeline.

## Granice bezpieczeństwa

- Docker: network `none` i brak portów jako default, read-only root, UID/GID 1000, writable bounded tmpfs, CPU/RAM/pids, cap-drop ALL, no-new-privileges. Timeout/output overflow kończy kontener, a nie wyłącznie CLI. Cleanup failure blokuje receipt i można ponowić cleanup.
- Jest to izolacja kontenera na wspólnym kernelu, nie gVisor/VM. Sekrety w `docker exec -e` są nadal widoczne administratorowi workera; żadnego claimu izolacji od hosta.
- Remote: HTTPS poza loopback, redirect refusal, timeout i bounded response; scoped worker przy starcie wymaga organization/project i tokenu 32+ znaków. Worker jest dedykowany projektowi; token nie jest tożsamością pojedynczego użytkownika.
- Worker startup nie usuwa globalnie wszystkich `osa.managed` kontenerów. Przy nieudanym cleanupie rekord jest zachowany; crash hosta wymaga scoped reconciliation operatora.
- Fleet: fencing kończy stare finalizacje; odzyskanie lease nie dowodzi zatrzymania zewnętrznego side effectu. Mission CAS odmawia ponownego uruchomienia EXECUTING. Automatyczny retry mission jest celowo fail-closed.
- Registry/cloud wymagają odrębnych grantów na konkretny mission/build/target/plan. Żaden z tych grantów nie jest automatycznie tworzony przez model lub publiczne API.
- Hash receipt dowodzi integralności i bindingu w zaufanym procesie, nie zewnętrznej autentyczności. Brak podpisu, WORM/anchoring i izolowanego niezależnego verifierservice.

## Co zostało celowo niewłączone i czego nie wolno oznaczać READY

- Cloud deployment nie był wykonany. Azure działa w testach kontraktowych z mockiem ARM; realna zgodność API, role IAM, quota, prywatny registry/image pull, health endpoint i billing wymagają oddzielnej walidacji po przeglądzie.
- `provision()` Azure sprawdza istniejący managed environment. Nie tworzy całej sieci/registry/environment; istniejący branch worker Azure jest źródłem IaC do osobnego przeglądu. Nie przenosimy i nie uruchamiamy jego szerokich skryptów deploymentu automatycznie.
- `DockerImagePublisher` obsługuje jeden hermetyczny artefakt JS i stały port 3000. To minimalny profil, nie dowolne monorepo, dependencies lub dowolny Dockerfile.
- Submission receipt nie oznacza READY. Executor deploy sprawdza live natychmiast; zasób PENDING blokuje sukces. Długotrwały Azure rollout wymaga oddzielnego ponowienia verification, nie automatycznego powtarzania publish/deploy.
- Brak realnego image build/push i brak registry credentials w tym review. Test publishera sprawdza kontrakt przez fake DockerCli. Nie nazywamy go dowodem opublikowanego obrazu.
- Koszt i latency historycznych Experiments pozostają UNKNOWN (`null`); koszt Azure też UNKNOWN. Nie ma egzekwowanego limitu finansowego.
- Fleet/benchmark/catalog przechowywane w PROCESS_MEMORY. Nie są trwałym rozproszonym schedulerem. MissionStore może być trwały lokalnie, ale nie czyni Fleet durable.
- Skalowanie Fleet to rekomendacja; nie uruchamia dodatkowych maszyn. TaskGraph/OsaRuntime pozostaje liniowy. Concurrency dotyczy wielu jobs, nie równoległego DAG wewnątrz jednej Mission.
- `McpHttpIntegration` implementuje initialize/list/call dla MCP Streamable HTTP z JSON; SSE/stdio/pagination fail closed. Test transportu ma mock server; brak live MCP server proof. Manifesty SKILL/PLUGIN wiążą już zarejestrowane executory i atomowo rejestrują capability; brak instalowania lub wykonywania obcych pakietów w control plane. Preview nie konfiguruje transportu, więc `/build/status` nadal wskazuje MCP/A2A UNSUPPORTED.
- Benchmark routing jest dostępny przez kontrakt `select`; nie zmienia przypiętego TeamGraph lub planu Brain w locie.
- S6 marketplace/paid pipelines/3D nie jest zakresem v0.3–v0.5. Receipts trafiają do istniejącego evidence/timeline; UI jest projekcją, nie źródłem wykonania.

## Rollback i dalsza ścieżka

Zmiany są przygotowane jako osobny branch do przeglądu; `main` nie jest zmieniany i nie wykonujemy deploymentu. Preview registry nie zawiera executora publikującego/deployującego. Wycofanie może polegać na pominięciu nowych modułów/routes; stare TeamGraph/fixture/provider API zachowuje testy regresji.

Najmniejsza ścieżka do Azure po przeglądzie: właściwy source/model executor → sandbox build/test → publisher z przypiętym base image i grantem registry → prywatny registry/IAM skonfigurowany poza core → Azure managed environment → explicit cloud grant → deploy → bounded readiness wait/status → live body validation → receipt chain → mission policy `required_receipts: ["live_verification_receipt"]` → COMPLETED. Każdy krok zewnętrzny wymaga nowego dowodu runtime; obecny lokalny dowód kończy się na build/test i MissionReceipt.
