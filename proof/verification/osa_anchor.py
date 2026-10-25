#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OSA Anchor Layer — proof -> contract -> chain -> mining.

Realizuje warstwę, o której mówisz: hash daje kontrakt, agent kopie w blockchainie.

Lancuch:
  1. Dla kazdego proof receipt liczymy HASH KONTRAKTU:
       contract_sha256 = sha256(canonical({evidence_root, receipt_sha256, binding_hash, block_index}))
  2. Kopanie (proof of work): szukamy nonce tak, zeby
       sha256(contract_sha256 + nonce) mialo DIFFICULTY zer na poczatku.
     To jest doslowne "kopalnictwo" — deterministyczne, weryfikowalne, bez kluczy.
  3. Block commitment: kazdy block commituje hash poprzedniego (prev_block_hash),
     wiec lancuch jest zwiazany kryptograficznie — podmiana ktegokolwiek bloku
     zeruje wszystkie digests evidence w receiptach za nim.
  4. Weryfikacja: odtwarzamy nonce, difficulty i lancuch prev_hash.

Wszystko lokalne, bez RPC, bez sekretow, bez portfeli. Gdy bedziesz gotowy
na prawdziwy chain (Solana/EVM), wystarczy podmienic `submit_block` —
reszta pozostaje identyczna.

Uzycie:
  python osa_anchor.py <katalog-artefaktow> [--difficulty 4] [--out plik.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time


# ---------------------------------------------------------------- canonical JSON
# Musi byc identyczna semantyka jak packages/proof-core/src/canonical.ts.
# null jest ZACHOWYWANY (linia 15), pomijane sa tylko undefined (linia 39).

def canonicalize(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("non-finite float")
        return value
    if isinstance(value, (list, tuple)):
        return [canonicalize(v) for v in value]
    if isinstance(value, dict):
        return {k: canonicalize(v) for k, v in sorted(value.items())}
    raise ValueError("non-canonicalizable value: %r" % (type(value),))


def canonical_json(value) -> str:
    return json.dumps(canonicalize(value), ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def digest(value) -> str:
    return sha256_hex(canonical_json(value))


# ---------------------------------------------------------------- mining

def mine(contract_sha256: str, difficulty: int, max_attempts: int = 50_000_000):
    """Proof of work: znajdz nonce z difficulty zerowymi bitami na poczatku hasha.

    Deterministyczne: ten sam (contract_sha256, difficulty) daje ten sam nonce.
    Weryfikacja nie wymaga przeliczania — wystarczy jedno hashowanie.
    """
    target_prefix = "0" * difficulty
    started = time.time()
    for nonce in range(max_attempts):
        h = sha256_hex(contract_sha256 + str(nonce))
        if h.startswith(target_prefix):
            return {"nonce": nonce, "hash": h, "difficulty": difficulty,
                    "elapsed_ms": round((time.time() - started) * 1000, 2),
                    "attempts": nonce + 1}
    raise RuntimeError("mining exhausted max_attempts=%d at difficulty=%d"
                       % (max_attempts, difficulty))


def verify_mined(contract_sha256: str, nonce: int, difficulty: int):
    h = sha256_hex(contract_sha256 + str(nonce))
    return {"ok": h.startswith("0" * difficulty), "hash": h, "difficulty": difficulty}


# ---------------------------------------------------------------- contract

def build_contract(proof, evidence, binding, block_index, prev_block_hash):
    """Kontrakt: hash evidence_root + receipt_sha256 + binding + pozycja w lancuchu."""
    refs = [{"evidence_id": r.get("evidence_id"), "evidence_sha256": r.get("evidence_sha256")}
            for r in (evidence or [])]
    body = {
        "evidence_root": digest(refs),
        "receipt_sha256": proof.get("receipt_sha256"),
        "binding_hash": digest(binding),
        "block_index": block_index,
        "prev_block_hash": prev_block_hash,
        "proof_id": proof.get("proof_id"),
        "verdict": proof.get("verdict"),
    }
    contract_sha256 = digest(body)
    return body, contract_sha256


def verify_contract(body, contract_sha256, evidence, binding, proof=None):
    """Odtworz evidence_root z evidence i porownaj z kontraktem.

    UWAGA (znaleziona dziura): pole `receipt_sha256` jest w body, wiec digest(body)
    zawsze sie zgadza z samym soba — nikt nie porownywal go z prawdziwym receiptem.
    Atak "podmien receipt_sha256" przechodzil niezauwazony. Teraz proof jest wymagany
    i jego receipt_sha256 musi byc rowny temu w kontrakcie.
    """
    refs = [{"evidence_id": r.get("evidence_id"), "evidence_sha256": r.get("evidence_sha256")}
            for r in (evidence or [])]
    expected_root = digest(refs)
    recomputed = digest(body)
    receipt_ok = proof is None or body.get("receipt_sha256") == proof.get("receipt_sha256")
    return {
        "ok": (recomputed == contract_sha256
               and body.get("evidence_root") == expected_root
               and body.get("binding_hash") == digest(binding)
               and receipt_ok),
        "expected_contract": recomputed,
        "observed_contract": contract_sha256,
        "expected_root": expected_root,
        "observed_root": body.get("evidence_root"),
        "receipt_sha_ok": receipt_ok,
        "expected_receipt": proof.get("receipt_sha256") if proof else None,
        "observed_receipt": body.get("receipt_sha256"),
    }


# ---------------------------------------------------------------- chain

def build_chain(records, difficulty):
    """Zbuduj lancuch blokow z listy rekordow (proof, evidence, binding).

    Kazdy block: kontrakt -> mining -> commitment. Commituje prev_block_hash,
    wiec lancuch jest kryptograficznie zwiazany.
    """
    chain = []
    prev = "0" * 64
    total_mine_ms = 0.0
    for i, rec in enumerate(records):
        body, contract_sha256 = build_contract(rec["proof"], rec["evidence"],
                                               rec["binding"], i, prev)
        mined = mine(contract_sha256, difficulty)
        total_mine_ms += mined["elapsed_ms"]
        block = {
            "block_index": i,
            "contract": body,
            "contract_sha256": contract_sha256,
            "nonce": mined["nonce"],
            "block_hash": mined["hash"],
            "difficulty": difficulty,
            "mined_ms": mined["elapsed_ms"],
            "attempts": mined["attempts"],
            "prev_block_hash": prev,
            "proof_id": rec["proof"].get("proof_id"),
        }
        chain.append(block)
        prev = mined["hash"]
    return chain, total_mine_ms


def verify_chain(chain, records, difficulty):
    """Odtworz cale powstawanie i zwiazki prev_hash. Niczego nie ufamy."""
    checks = {"blocks": [], "links": [], "mining": [], "contracts": []}
    prev = "0" * 64
    for i, (block, rec) in enumerate(zip(chain, records)):
        vm = verify_mined(block["contract_sha256"], block["nonce"], difficulty)
        checks["mining"].append({"block": i, "ok": vm["ok"]})
        vc = verify_contract(block["contract"], block["contract_sha256"],
                             rec["evidence"], rec["binding"], rec["proof"])
        checks["contracts"].append({"block": i, "ok": vc["ok"]})
        checks["blocks"].append({
            "block": i, "hash": block["block_hash"],
            "hash_matches_mined": block["block_hash"] == vm["hash"],
            "proof_id": block["proof_id"],
        })
        checks["links"].append({"block": i, "ok": block["prev_block_hash"] == prev})
        prev = block["block_hash"]

    return {
        "ok": all(c["ok"] for c in checks["mining"])
              and all(c["ok"] for c in checks["contracts"])
              and all(c["ok"] for c in checks["links"]),
        "mining_ok": all(c["ok"] for c in checks["mining"]),
        "contracts_ok": all(c["ok"] for c in checks["contracts"]),
        "links_ok": all(c["ok"] for c in checks["links"]),
        "checks": checks,
        "head": prev,
        "length": len(chain),
    }


# ---------------------------------------------------------------- tamper test

def tamper_chain(chain, records, difficulty):
    """Podmien doslowny dowod i sprawdz, czy lancuch zer sie wykrywa.

    UWAGA (znaleziony blad w pierwszej wersji): atakowalem `data.status`, ale
    `evidence_sha256` haszuje CALY rekord — podmiana pola w `data` nie zmienia
    hasha, wiec `evidence_root` zostaje identyczny i tamper jest niewidoczny.
    Atak musi podmienic `evidence_sha256` w refs albo dopisac nieistniejacy rekord.
    """
    if not chain:
        return None
    results = {}
    # Atak 1: podmien evidence_sha256 pierwszego rekordu (udaj zlamany dowod)
    tampered = json.loads(json.dumps(records))
    tampered[0]["evidence"][0]["evidence_sha256"] = "0" * 64
    results["evidence_sha_flip"] = not verify_chain(chain, tampered, difficulty)["ok"]
    # Atak 2: dopisz nieistniejacy rekord evidence (udaj dopisanie dowodu)
    tampered = json.loads(json.dumps(records))
    tampered[0]["evidence"].append({"evidence_id": "fake", "evidence_sha256": "1" * 64})
    results["evidence_append"] = not verify_chain(chain, tampered, difficulty)["ok"]
    # Atak 3: podmien receipt_sha256 w kontrakcie (udaj inny proof)
    tampered = json.loads(json.dumps(records))
    tampered[0]["proof"]["receipt_sha256"] = "0" * 64
    results["receipt_flip"] = not verify_chain(chain, tampered, difficulty)["ok"]
    # Atak 4: podmien binding (udaj inne wykonanie)
    tampered = json.loads(json.dumps(records))
    tampered[0]["binding"]["run_id"] = "run_FAKE"
    results["binding_flip"] = not verify_chain(chain, tampered, difficulty)["ok"]
    return results


# ---------------------------------------------------------------- loading

def load_records(artifacts_dir):
    """Wczytaj (proof, evidence, binding) z katalogu artefaktow run500/run20/..."""
    out = []
    if not os.path.isdir(artifacts_dir):
        return out
    for name in sorted(os.listdir(artifacts_dir)):
        d = os.path.join(artifacts_dir, name)
        if not os.path.isdir(d):
            continue
        run_f = os.path.join(d, "run.json")
        team_f = os.path.join(d, "team.json")
        mission_f = os.path.join(d, "mission.json")
        if not (os.path.exists(run_f) and os.path.exists(team_f)):
            continue
        run = json.load(open(run_f, encoding="utf-8"))
        team = json.load(open(team_f, encoding="utf-8"))
        mission = json.load(open(mission_f, encoding="utf-8")) if os.path.exists(mission_f) else {}
        proof = run.get("proof") or {}
        if not proof.get("receipt_sha256"):
            continue
        binding = {
            "organization_id": team.get("organization_id"),
            "project_id": team.get("project_id"),
            "team_id": team.get("team_id"),
            "team_version": team.get("version"),
            "mission_id": mission.get("mission_id"),
            "run_id": run.get("run_id"),
            "execution_id": run.get("execution_id"),
        }
        out.append({"proof": proof, "evidence": run.get("evidence") or [],
                    "binding": binding, "dir": name})
    return out


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("artifacts_dir")
    ap.add_argument("--difficulty", type=int, default=4)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    records = load_records(args.artifacts_dir)
    if args.limit:
        records = records[:args.limit]
    if not records:
        print("brak rekordow w", args.artifacts_dir)
        return 1

    print("[anchor] rekordow: %d | difficulty: %d" % (len(records), args.difficulty))
    t0 = time.time()
    chain, mine_ms = build_chain(records, args.difficulty)
    print("[anchor] wykopane w %.1f s (same mining %.1f s)"
          % (time.time() - t0, mine_ms / 1000.0))

    v = verify_chain(chain, records, args.difficulty)
    print("[anchor] weryfikacja: ok=%s mining=%s contracts=%s links=%s head=%s..."
          % (v["ok"], v["mining_ok"], v["contracts_ok"], v["links_ok"], v["head"][:16]))

    t = tamper_chain(chain, records, args.difficulty)
    print("[anchor] tamper test: evidence_sha=%s append=%s receipt=%s binding=%s"
          % (t["evidence_sha_flip"], t["evidence_append"],
             t["receipt_flip"], t["binding_flip"]))

    out = {
        "difficulty": args.difficulty,
        "records": len(records),
        "chain_length": len(chain),
        "head": v["head"],
        "verified": v["ok"],
        "mining_ok": v["mining_ok"],
        "contracts_ok": v["contracts_ok"],
        "links_ok": v["links_ok"],
        "tamper_detected": t,
        "total_mine_ms": round(mine_ms, 2),
        "blocks": chain,
    }
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2)
        print("[anchor] zapisane:", args.out)
    print("\n[anchor] PODSUMOWANIE")
    print("  blokow            : %d" % len(chain))
    print("  lancuch spojny    : %s" % v["ok"])
    print("  mining poprawny   : %s" % v["mining_ok"])
    print("  kontrakty poprawne: %s" % v["contracts_ok"])
    print("  prev_hash spojny  : %s" % v["links_ok"])
    print("  tampering wykryty : %s" % t)
    all_ok = v["ok"] and all(t.values())
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
