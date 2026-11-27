# OSA Proof Registry

The existing Durable worker supports Ollama through its loopback API. A worker configured with `OSA_DURABLE_CHAT_TRUST` can sign a released chat result for the configured organization, project, identity and agent. Keep the signing configuration on that worker. It contains a private key.

The recorded audit contains the public identity, delegation, runtime attestation, ActionReceipt, ProofBatch and the inclusion proofs for both receipts. Verify the controller and agent keys against trusted configuration, verify ProofReceipt V2 against the recorded evidence and output, then verify both inclusions against the same batch. A passed Supervisor check and a valid signature have different meanings.

## Registry protocol

- The config account is the PDA derived from `registry-v1`. Instruction 0 takes the authority, config, deployment key and System Program. The first and third accounts sign. The deployment key must match the program address.
- Instruction 1 takes the configured signing authority, config, commitment PDA and System Program. Instruction bytes are the opcode, the 32-byte batch digest and the 32-byte Merkle root. The PDA seeds are `proof-v1` and the batch digest.
- The commitment account stores version 1, the 32-byte authority and the two 32-byte digests. The same record is idempotent. A conflicting record is rejected. The tenant and execution references stay off-chain in the signed proof.
- Before broadcast, persist the signature and last valid block height from `submitRegistryCommitment`. Use the same signature for recovery. For an ambiguous result, reconcile finalized RPC state before making any retry decision.
- `verifyRegistryCommitment` checks Devnet's genesis hash, the finalized transaction, the expected program instruction and signer and the contents and owner of the commitment account. Genesis Anchor #000001 is a historical Memo transaction with a separate payload.

## Evidence boundary

A local run on Ollama `qwen2.5:3b` completed as `exec_0e786865-2b4b-4b5c-bd6e-b3d69e26bac6`. The isolated test identity's ActionReceipt signature, ProofReceipt integrity and both Merkle inclusions passed. Its status was `NOT_ANCHORED`. The production UI and Registry finalization require evidence from the same production execution before they can be called verified.
