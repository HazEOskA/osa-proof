# OSA Proof — agent notes

## North Star

OSA ma być najlepszym frameworkiem agentowym na świecie w 2026.

To cel, nie twierdzenie. Zgodnie z CLAIM != PROOF każdy slice musi zostawić
mierzalny dowód: zielone testy, proof receipt, zachowanie fail-closed.
Cel nigdy nie uzasadnia osłabienia wymagań dowodowych ani rozszerzenia zakresu bez zgody.

## Source of truth

- Architektura: `docs/ARCHITECTURE_LOCK_V1.md`, `docs/BACKEND_ARCHITECTURE_LOCK_V1.md`.
- Dowód: `docs/PROOF_PROTOCOL_V1.md`. Team Graph: `docs/TEAM_GRAPH_CONTRACT_V1.md`.
- Właściciel projektu jest źródłem prawdy. Przy niepewności: zatrzymaj się i zapytaj.

## Workflow

- Przed edycją: raport (target, scope, pliki, ryzyka, plan testów) i zgoda.
- Walidacja: `npm test` (wszystkie istniejące testy muszą przechodzić).
- Nie zmieniaj semantyki `OsaRuntime`, `ExecutorRegistry`, Evidence Collector ani Proof Core bez wyraźnej zgody.
