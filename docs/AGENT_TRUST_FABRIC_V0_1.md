# OSA @ai Agent Trust Fabric v0.1

Status: implementation slice on `feature/agent-trust-fabric-v0.1`.

## Goal

Extend OSA Proof v2 without changing `osa.proof_receipt.v2`:

```text
@ai identity
  -> signed delegation
  -> runtime attestation
  -> signed causal action receipts
  -> existing ProofReceipt v2
  -> Merkle ProofBatch
  -> chain-neutral ProofAnchor
```

`CLAIM != PROOF` remains the invariant.

## What v0.1 adds

- `@ai:<authority>[/profile]` parser and canonicalizer.
- Ed25519 agent/controller signing primitives.
- `AgentIdentityV1`.
- `DelegationV1` with scope, deny list and validity window.
- `RuntimeAttestationV1`.
- `ActionReceiptV1` with parent receipt linkage and evidence references.
- `ProofBatchV1` containing both the existing ProofReceipt digest and action receipt digests.
- Merkle inclusion proofs.
- `ProofAnchorAdapter` and deterministic anchor/batch binding verification.
- API surfaces for trust status, configured `/.well-known/ai-profile.json`, and action receipt verification.

## Deliberate boundaries

This slice does **not**:

- merge or deploy anything,
- submit blockchain transactions,
- replace MCP, A2A, OpenAPI or OAuth,
- store chain-of-thought,
- put prompts, secrets or raw customer payloads on-chain,
- change the `osa.proof_receipt.v2` schema.

## Cryptographic boundary

Action receipts cover observable execution metadata:

```text
agent identity
runtime identity
run / execution / operation ids
delegation digest
policy digest
input digest
request digest
result digest
evidence references
causal parent
timestamp
signature
```

The receipt is signed with Ed25519 over canonical JSON already used by OSA Proof.

## Blockchain boundary

`ProofAnchorAdapter` is chain-neutral. A live adapter must be separately approved and must return a `CHAIN_CONFIRMED` receipt. No adapter in this slice submits a real transaction.

## Verification

The Trust Fabric tests require:

- deterministic `@ai` canonicalization,
- valid/expired delegation behavior,
- signature verification,
- tamper detection,
- causal action receipt chaining,
- ProofReceipt v2 + action receipt Merkle batching,
- inclusion proof verification,
- anchor/batch binding,
- unchanged ProofReceipt v2 input.
