# Hermes — Quick Start audytu OSA Proof (READ-ONLY)

**Stan odniesienia:** 28.10.2026. **Repo:** `HazEOskA/osa-proof`. **Kod Preview:** `56dd60612f844faa9380c3243fe7eb9074a618d7`, gałąź `fix/osa-proof-neurosa-protected-preview-20261028`.

**Cel:** bezstronnie zweryfikować konkretny, wyeksportowany przebieg OSA Proof (operator widział w Replay 47 pozycji). Nie traktować liczby 47 ani zrzutów ekranu jako potwierdzenia kompletności lub rzeczywistego wykonania.

## Granice uprawnień

- **READ-ONLY wobec OSA Proof, NeurOSA, Vercel, Railway i repo źródłowego.** Dopuszczalne są tylko lokalne pliki robocze i lokalne kopie wejścia w odizolowanym katalogu audytu.
- Bez uruchamiania misji na aktywnym Preview, bez zapisu do Brain, bez restartów, deploy, zmian ENV, commitów, PR, merge i zmian produkcji.
- Nie żądaj kluczy NVIDIA, tokenów NeurOSA, ciasteczek, bypass tokenów ochrony Preview, sesji użytkownika ani prywatnych materiałów. Nie otwieraj chronionego Preview bez osobnej zgody operatora.
- Eksport może zawierać prompt, prywatny kontekst i dane użytkownika. Audytuj wyłącznie pliki dopuszczone do przekazania. **Nie przesyłaj ich do zewnętrznych modeli/API**; raport powinien usuwać dane wrażliwe.
- Jeśli nie masz eksportu konkretnej misji, zgłoś `BLOCKED — INPUT_MISSING`. Nie podstawiaj starszych fixture z repo zamiast niej.

## 1. Sprawdź kod i środowisko (na osobnej maszynie/katalogu, nie w produkcyjnym VPS)

Node.js **20+**, Git i npm. Uruchom w odizolowanym workspace:

```bash
git clone https://github.com/HazEOskA/osa-proof.git osa-proof-audit
cd osa-proof-audit
git fetch origin fix/osa-proof-neurosa-protected-preview-20261028
git checkout --detach 56dd60612f844faa9380c3243fe7eb9074a618d7
git rev-parse HEAD
node --version
npm ci --ignore-scripts
npm test
```

Zapisz: dokładny SHA, wersję Node, wyjście `npm test`, liczbę PASS/FAIL/SKIP. Błędy i SKIP nie są PASS. Testy lokalne **nie** są dowodem działania live ani testem tej konkretnej misji.

**Uwaga:** bieżąca dokumentacja audytu znajduje się na gałęzi `fix/osa-proof-neurosa-protected-preview-20261028`, która może zawierać późniejsze commity *tylko dokumentacyjne*. Kod do odtworzenia wdrożenia sprawdzaj na podanym, przypiętym SHA.

## 2. Pozyskaj właściwy eksport od operatora (bez dostępu do sekretów)

W widoku **Czat floty agentów → wynik „Utwórz artefakt”** są przyciski:
`Pobierz artefakt`, `Pobierz bundle`, `Pobierz evidence`, `Pobierz trace`, `Pobierz ProofReceipt`, `Pobierz replay offline`.

Poproś o przekazanie sześciu plików **z jednego wykonania**, po sprawdzeniu przez operatora, czy nie zawierają danych prywatnych. Zapisz ich SHA-256 i oryginalne nazwy. Nie mieszaj plików z różnych `execution_id`.

W szczególności:
- `*-bundle.json`: `schema = osa.chat_delivery.v1`, `bundle_sha256`, `record`, `run`, `report`, `artifact`.
- `*-trace.jsonl`: jeden wpis z `record.timeline` na linię.
- `*-evidence.json`: `run.evidence`.
- `*-proof.json`: `run.proof`.
- Artefakt HTML lub Markdown: rzeczywista zawartość, którą należy sprawdzić.
- `*-replay.html`: odtwarzacz **zapisanych** zdarzeń; nie wykonuje ponownie narzędzi.

**To inny format niż** przycisk **„Pobierz zapis misji”** w Studio. Taki plik jest `osa.mission.v1` i można go weryfikować bezpośrednio za pomocą `scripts/verify-mission-record.cjs`. Nie uruchamiaj tego CLI na całym `osa.chat_delivery.v1`; użyj `bundle.record` albo poniższego testu.

## 3. Niezależny test eksportu ChatDelivery

Umieść dostarczone pliki w lokalnym `audit-input/` (zmień nazwy *kopii*, nie oryginałów, na `bundle.json`, `artifact.html` / `artifact.md`, `evidence.json`, `trace.jsonl`, `proof.json`). Potem z katalogu repo uruchom:

```bash
node - audit-input/bundle.json audit-input/artifact.html audit-input/evidence.json audit-input/trace.jsonl audit-input/proof.json <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { digest, verifyCompletedMission } = require('./dist/packages/proof-core/src');
const [bundlePath, artifactPath, evidencePath, tracePath, proofPath] = process.argv.slice(2);
const b = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
assert.equal(b.schema, 'osa.chat_delivery.v1');
const { bundle_sha256, ...body } = b;
assert.equal(digest(body), bundle_sha256);
assert.equal(b.execution_id, b.run.execution_id);
assert.equal(b.execution_id, b.run.proof.execution_id);
assert.equal(b.status, 'EXECUTED');
assert.equal(b.run.verdict, 'VERIFIED');
verifyCompletedMission(b.record);
assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, 'utf8')), b.run.evidence);
assert.deepEqual(JSON.parse(fs.readFileSync(proofPath, 'utf8')), b.run.proof);
const timeline = fs.readFileSync(tracePath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
assert.deepEqual(timeline, b.record.timeline);
assert.ok(b.artifact, 'No artifact');
const bytes = fs.readFileSync(artifactPath);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), b.artifact.sha256);
assert.equal(bytes.length, b.artifact.bytes);
assert.equal(bytes.toString('utf8'), b.artifact.content);
const altered = structuredClone(b.record);
altered.timeline = altered.timeline.slice(1);
assert.throws(() => verifyCompletedMission(altered), 'Removed timeline event must be rejected');
console.log(JSON.stringify({
  verdict: 'PASS_LOCAL_INTEGRITY_ONLY',
  execution_id: b.execution_id,
  timeline_events: timeline.length,
  agent_starts: b.run.events.filter(e => e.type === 'AGENT_STARTED').length,
  evidence_records: b.run.evidence.length,
  source_authenticity: 'NOT_ESTABLISHED',
  semantic_correctness: 'NOT_ESTABLISHED'
}, null, 2));
NODE
```

Dla Markdown podstaw w argumencie `audit-input/artifact.md`. Jeżeli test nie przejdzie, zgłoś błąd i dokładnie wskaż etap; nie „naprawiaj” wejścia, aby dostać PASS.

Dodatkowo uruchom niezależny test struktury, odmowy dla zmienionego evidence, usuniętego eventu, podmienionych identyfikatorów oraz przeliczonego lokalnie hasha na **kopii**. Zweryfikuj też, czy liczba widocznych pozycji Replay odpowiada `timeline.length`. Pamiętaj, że **47 pozycji timeline to niekoniecznie 47 operacji agentów lub wywołań narzędzi**.

## 4. Jeśli otrzymasz eksport MissionRecord ze Studio

```bash
node scripts/verify-mission-record.cjs audit-input/mission-record.json
```

Do sprawdzenia *treści* evidence skrypt przyjmuje opcjonalny drugi plik JSON: mapę `evidence_id → oryginalna treść UTF-8`. Brak dostarczonej treści oznacza brak pełnego dowodu kompletności artefaktów. Weryfikacja lokalnej integralności **nie** zapewnia autentyczności źródła, izolacji wykonawców ani poprawności semantycznej.

## 5. Wymagany raport Hermesa

Zwróć:
1. `repo_sha`, `deployment_sha_claim`, `execution_id` / `mission_id`, SHA-256 otrzymanych plików oraz ich pochodzenie;
2. Liczbę kroków Replay, eventów timeline, zdarzeń `AGENT_STARTED`, faktycznych wywołań narzędzi i powiązanych evidence — **osobno**, bez utożsamiania liczb;
3. Macierz `event_id → agent → operation_id → evidence_id → proof`, w tym luki;
4. Wynik CLI i testów negatywnych, realne stdout/stderr, kody zakończenia;
5. Oceny `INTEGRITY`, `COMPLETENESS`, `SOURCE_AUTHENTICITY`, `SEMANTIC_CORRECTNESS`, `PERSISTENCE`, `AUTH/RBAC` — każda jako `PASS / PARTIAL / FAIL / UNKNOWN / BLOCKED`;
6. Werdykt końcowy **PASS / PARTIAL / FAIL / BLOCKED** wraz z konkretnymi plikami dowodowymi.

**Zakaz:** `READY`, zielony Proof w UI, 272 historyczne PASS z testów lokalnych ani działający replay same w sobie **nie** uprawniają do werdyktu produkcyjnego PASS.

## 6. Stan i dokumenty pomocnicze

- [Status Preview (28.10.2026)](./OSA_PROOF_PREVIEW_STATUS_2026-10-28.md) — rozdzielenie obserwacji live i luk.
- [Integracja lokalna i raport Final Boss](./final-boss/INTEGRATION_REPORT.md) — *historyczne* wyniki z fixture/testową sesją.
- [Ocena bezpieczeństwa](./final-boss/SECURITY_VERDICT.md) — **BLOCKED** do produkcji.
- [Protokół Proof v2](./PROOF_PROTOCOL_V2.md) — SHA-256 bez zewnętrznego zakotwiczenia.
- [Czat → model → artefakt → dowody](./CHAT_ARTIFACT_FLOW.md) — eksporty i ograniczenia.

**DONE:** Hermes dostarczył audyt oparty o *rzeczywisty przekazany eksport* i wskazał, co potwierdzono, a czego nie. Brak eksportu = **BLOCKED**, nie „wygląda na PASS”.
