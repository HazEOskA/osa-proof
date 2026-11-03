# Proof Export / Replay — jak interpretować i weryfikować materiał

**Obowiązuje:** 03.11.2026. **Tryb audytu:** READ_ONLY, lokalne kopie, bez uruchamiania usług i bez wysyłania prywatnych danych do zewnętrznych API.

## Trzy odrębne ścieżki

| Ścieżka UI | Format | Zastosowanie |
| --- | --- | --- |
| **Czat floty → Utwórz artefakt** | `osa.chat_delivery.v1` | Raport, HTML/Markdown, `record`, `run`, `bundle_sha256`, Evidence, Proof i Replay |
| **Budowanie → Studio → Pobierz zapis misji** | `osa.mission.v1` | MissionKernel, odtworzenie rzeczywistego rekordu misji, weryfikacja `verify-mission-record.cjs` |
| **Czat floty → Live Trace / Pobierz trace, evidence** | `osa.live_execution.v1`, `osa.live_metadata.v1` | Obserwacja UI/SSE; może zawierać tylko zdarzenia `BROWSER`, nie pełny proof |

**Nie wolno** używać liczby zdarzeń jako liczby realnych tool calls. `Replay` odtwarza zapis, a nie wykonuje modelu ponownie. `VERIFIED` może poświadczać tylko warunek `delivery_ready_for_review`.

## Zestaw eksportów z jednego wykonania ChatDelivery

`*-bundle.json`, `*-evidence.json`, `*-trace.jsonl`, `*-proof.json`, artefakt HTML/Markdown oraz `*-replay.html`. Wszystkie muszą pochodzić z jednego `execution_id`. Brak jednego pliku = audyt tylko częściowy, nie fałszywy PASS.

Dla repo z wykonanym lokalnym buildem użyj istniejącego runbooka [HERMES_AUDIT_QUICK_START](./HERMES_AUDIT_QUICK_START.md), zachowując zgodność wersji `dist/` z audytowanym formatem. `scripts/verify-mission-record.cjs` przyjmuje `osa.mission.v1`, nie cały `osa.chat_delivery.v1`.

## Minimalne kontrole niezależne

1. Poprawne JSON/JSONL, schematy, dopasowane `execution_id`/`run_id`/`mission_id`.
2. SHA-256 `bundle` nad canonical JSON bez `bundle_sha256`.
3. SHA-256 `ProofReceipt` bez `proof_id` i `receipt_sha256`, a `proof_id = proof_ + digest`.
4. Każde `evidence_sha256`, `evidence_root`, `final_output_sha256` oraz powiązane observations/records — przez istniejący verifier.
5. Bytes/hash artefaktu, zgodność z `artifact.content`, trace JSONL z `record.timeline`, proof/evidence z `run`.
6. Negatywny test na **kopii**: zmiana bajtu, brak eventu lub wymiana `execution_id` muszą zostać odrzucone przez weryfikację integralności.
7. Odnotować liczbę `AGENT_STARTED`, `tool_calls`, distinct `producer.executor_ref`, źródło `BROWSER` vs API oraz status podpisów/egress.

Nie weryfikujemy tym samym prawdziwości danych modelu ani niezależnej tożsamości dostawcy. Złośliwy aktor posiadający kontrolę nad całym zapisem może go spójnie ponownie zahashować — bez podpisu/zewnętrznego anchoringu dowód nie ma takiej gwarancji pochodzenia.

## Przykład: export otrzymany 3 listopada 2026

- `record.timeline`: **65** zdarzeń.
- `run.events`: **47**.
- `AGENT_STARTED`: **10** (wszystkie etapy `demo.*`).
- `run.evidence`: **13**.
- `run.observations`: **27**.
- `run.tool_calls`: **0**.
- `run.verdict`: **VERIFIED** przy wymaganiu `delivery_ready_for_review`.
- Weryfikacja lokalna: zgodny hash bundle, ProofReceipt, 13/13 Evidence, treść/bytes/hash artefaktu, eksporty Evidence/Proof/trace.
- `egress_status`: **NOT_ENFORCED**; `signature_status`: **UNAVAILABLE**.

**Wniosek:** ścieżka „model → artefakt → policy/structural checks → ProofReceipt → eksport” działa w badanym scenariuszu. **Nie dowodzi to wykonania operacji na plikach repo przez dwóch realnych workerów.** Wygenerowane w HTML wpisy typu `config.txt`, `receipt1` i `Worker 2` stanowią tekst demonstracyjny, nie rzeczywisty materiał dowodowy.

## Prywatność i publikacja

Prywatnego bundle (w tym `conversation_id`, pamięci i promptu) nie dołączono do propozycji repo. Przed umieszczeniem jakiegokolwiek nowego `docs/evidence/*` wymagane są: redakcja danych wrażliwych, zgoda operatora, wskazanie źródła, dokładnego SHA i granicy odtworzenia.

**Werdykt formatowy:** `PASS_LOCAL_INTEGRITY_ONLY` · **Dwaj workery real E2E:** `NOT PROVEN`.
