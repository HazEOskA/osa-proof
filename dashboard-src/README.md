# OSA Dashboard

Control plane UI dla `HazEOskA/osa-proof`. React + Vite + Tailwind + three.js. Wygląd wg design systemu OSA Framework (motywy `proof` i `godmode`). Knowledge World to układ słoneczny 3D: słońce = Team Graph, orbita = typ węzła, planeta = realna encja.

## Dane

UI czyta i uruchamia prawdziwe kontrakty `osa-proof`: Team Graph, Mission, RuntimeEvent, EvidenceRecord i ProofReceipt v2.

- **LIVE**: gdy `/api` odpowiada, dashboard pobiera `/layers`, `/teams/:id`, `/runs/:id`.
- **LIVE EXECUTION**: Mission View wysyła Team Graph + Mission do backendu, uruchamia `/missions/:id/run`, a potem renderuje zwrócone events/evidence/proof.
- **LAYER AUTHORITY**: Home wywołuje backendowe `POST /layers/:id/enter` i pokazuje `ALLOWED`/`GATED` z wymaganiami backendu.
- **SNAPSHOT**: gdy API nie odpowiada, UI używa `src/data/snapshot.json` i oznacza to w nagłówku.
- Czego `osa-proof` nie raportuje (np. koszt/model/latency, jeśli nie ma tego w kontrakcie), UI pokazuje jako `unknown`. Nic nie jest zgadywane.

Snapshot pochodzi z trybu **fixture** (deterministyczny, offline), nie z realnego providera.

## Uruchomienie

```bash
npm install
npm run dev
npm run build
```

## Zakres integracji

Dashboard otwiera się bez ekranu logowania, bo `osa-proof` nie ma obecnie kontraktu auth i UI nie udaje uwierzytelnienia.

Zintegrowane powierzchnie:
- Home + backend layer authority,
- Knowledge World,
- Missions + real execution,
- Tracing / runtime events,
- Evidence,
- ProofReceipt v2 + recomputation,
- Replay,
- Command Palette,
- responsive desktop/mobile shell.

Niezaimplementowane funkcje backendowe pozostają jawnie oznaczone jako niedostępne zamiast być symulowane.

## Znane ograniczenia

- `ApiState` backendu jest obecnie in-memory. Dashboard przed każdym runem ponownie zapisuje Team Graph i Mission, żeby wytrzymać cold start instancji serverless; nie jest to trwała baza danych.
- ProofReceipt v2 jest hash-sealed i przeliczany deterministycznie, ale nie jest podpisem kryptograficznym niezależnej zewnętrznej strony.
- Produkcyjny provider jest osobnym trybem backendu; preview Vercel pozostaje na `fixture`, dopóki operator świadomie nie zmieni konfiguracji.
