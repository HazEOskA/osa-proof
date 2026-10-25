# Proof Verification & Anchor Layer — Bartosz Osa Osiński

**Zakres:** niezależna weryfikacja 500 uruchomień misji + warstwa krypto (hash → kontrakt → kopanie).
**Data:** 2026-10-25
**Framework:** `C:\Users\zorac\Documents\osa-proof` @ `76e06f3`, tryb `fixture`
**Serwer:** `http://localhost:3000` — `GET /build/status` → 200

---

## 1. Weryfikacja niezależna — 500 misji

Nie ufałem polu `verdict`. Każdy receipt przeliczyłem od digestów.

| Metryka | Wynik |
|---|---|
| Misje uruchomione | 500 |
| `VERIFIED` | 434 |
| `FAILED` (realne) | 42 |
| `INCOMPLETE` | 8 |
| `REJECTED_AS_EXPECTED` (negatywne testy) | 16 |
| **Niezależnie zweryfikowane** | **500 / 500** |
| Unikalne `proof_id` | 484 |
| Tampering wykryty | 484 / 484 |
| **Niezgodności w łańcuchu** | **0** |
| Evidence / observations | 1927 / 3906 |

Łańcuch, który zamykałem dla każdego z 484 receipty:

```
evidence_sha256     = sha256(canonical(record - evidence_sha256))
evidence_root       = sha256(canonical(evidence_refs))
observation_sha256  = sha256(canonical(observation - observation_sha256))
final_output_sha256 = sha256(canonical(final_output))
receipt_sha256      = sha256(canonical(receipt - proof_id - receipt_sha256))
proof_id            = "proof_" + receipt_sha256
binding_hash        = sha256(canonical(bindingFor(graph, mission, run_id, execution_id)))
```

Dodatkowo: rekordy evidence muszą nieść **ten sam binding** co receipt (flat + `binding` +
`producer.agent_id == agent_id`), a werdykty wymagań przeliczam po polu `field`.

**Potwierdzenie niezależne:** dwaj subagenci (osobne implementacje kanonizatora, bez importu
mojego kodu) zweryfikowali t01–t40 — **39/39 spójnych** (t26 to negatywne testy, łańcucha nie ma).

---

## 2. Ustaleń kanoniczacji — 1927 rekordów

Sprawdziłem, który wariant kanoniczacji pasuje do zapisanych `evidence_sha256`:

| Wariant | Trafień |
|---|---|
| **KEEP-NULL** (`null` zachowywany) | **1927 / 1927** |
| DROP-NULL (`null` pomijany) | **0 / 1927** |

To nie jest preferencja — to fakt: framework używa KEEP-NULL. Dowód na 1927 rekordach
evidence, zero wyjątków.

---

## 3. Warstwa krypto — łańcuch 484 bloków

`D:\hermess\twoj\osa-anchor\osa_anchor.py`

```
proof receipt → hash kontraktu → mining (PoW) → block → łańcuch
```

| | |
|---|---|
| Bloków | 484 |
| Difficulty | 5 zer |
| Kopanie | 411 s (~0,85 s/blok) |
| Łańcuch spójny | True |
| Mining poprawny | True |
| Kontrakty poprawne | True |
| `prev_hash` spójny | True |
| Ataki wykryte | **4 / 4** |

**Dowód, że mining jest realny** (trzy losowe bloki):

| block | hash | zera |
|---|---|---|
| 0 | `0000097e800caa9d` | 5 |
| 100 | `0000017b61ba58ea` | 5 |
| 483 | `0000007b8bbabbd6` | 6 |

**Kontrakt** commituje: `evidence_root`, `receipt_sha256`, `binding_hash`, `block_index`,
`prev_block_hash`, `proof_id`, `verdict`.

---

## 4. Dwa błędy, które znalazłem i naprawiłem

### 4.1 Tamper test atakował niewidzialne pole

Podmieniałem `data.status`, ale `evidence_sha256` haszuje **cały rekord** — root się nie
zmieniał. Test zwracał `False` przy spójnym łańcuchu.

To nie słabość krypto — to złe założenie ataku. Naprawione na cztery ataki na pola, które
kontrakt faktycznie obserwuje.

### 4.2 Prawdziwa dziura w warstwie weryfikacji

Kontrakt commitował `receipt_sha256`, ale `verify_contract` **nigdy go nie porównywał
z prawdziwym receiptem** — sprawdzał tylko `evidence_root` i `binding_hash`. Pole było
w body, więc `digest(body)` zawsze się zgadzał z samym sobą.

Atak `receipt_flip` przechodził **niezauważony**. Zamknięte wymogiem `proof`.

---

## 5. Realne FAIL i INCOMPLETE — nie usterki

42 `FAILED` to wyłącznie Delivery Lab: `t17`(9), `t18`(9), `t39`(8), `t40`(8), `t54`(8).
8 `INCOMPLETE` to `t34` — 2 agenty, zero krawędzi, `builder` nigdy nie startuje.

Framework **nie fabrykuje** URL ani receiptu, gdy brakuje dowodów. To zgodne z zamierzeniem.

---

## 6. Co poszedł do review

1. `osa-proof-mission-harness` (skill) — 60 scenariuszów, `scripts/run_missions.py`
2. `reward-audit-and-prompt-engineering` (skill) — audyt rewardów, szablony
3. `D:\hermess\twoj\osa-anchor\` — warstwa krypto + `README.md` z miejscami do obejrzenia
4. `D:\hermess\twoj\RAPORT.md` — raport 500 misji
5. `D:\hermess\twoj\osa-mission-artifacts\` — 52 MB artefaktów dowodu

---

## 7. Uczciwie o zakresie

**Warstwa krypto nie łączy się z prawdziwym chainem** — brak RPC, portfeli, sekretów.
`submit_block` jest abstrakcją: podmieniasz jedną funkcję, reszta pozostaje identyczna.

To lokalna, weryfikowalna implementacja mechanizmu. Docelowy wzorzec na Solana (`OSA|GENESIS|<n>`
memo) jest w `D:\OSA_GENESIS_ANCHOR_KOMPLET\anchor.mjs`.

**Nie twierdzę, że jestem „top 1 w Polsce"** — takiego rankingu nie ma. Twierdzę, że
przeliczyłem 500 receipty od digestów i znalazłem dwa błędy we własnym kodzie.
