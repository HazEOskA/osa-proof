# OSA Proof Registry

The existing Durable worker supports Ollama through its loopback API. A worker configured with `OSA_DURABLE_CHAT_TRUST` can sign a released chat result for the configured organization, project, identity and agent. Keep the signing configuration on that worker. It contains a private key.

The recorded audit contains the public identity, delegation, runtime attestation, ActionReceipt, ProofBatch and the inclusion proofs for both receipts. Verify the controller and agent keys against trusted configuration, verify ProofReceipt V2 against the recorded evidence and output, then verify both inclusions against the same batch. A passed Supervisor check and a valid signature have different meanings.

## Registry protocol

- The config account is the PDA derived from `registry-v1`. Instruction 0 takes the authority, config, deployment key and System Program. The first and third accounts sign. The deployment key must match the program address.
- Initialize with `initializeRegistry` only after deployment, using dedicated Devnet credentials. Keep the deployment key separate from the authority used to submit batches.
- Instruction 1 takes the configured signing authority, config, commitment PDA and System Program. Instruction bytes are the opcode, the 32-byte batch digest and the 32-byte Merkle root. The PDA seeds are `proof-v1` and the batch digest.
- The commitment account stores version 1, the 32-byte authority and the two 32-byte digests. The same record is idempotent. A conflicting record is rejected. The tenant and execution references stay off-chain in the signed proof.
- Before broadcast, persist the signature, signed transaction bytes and last valid block height. Signed bytes are private broadcast material and are excluded from the public status. When finalized readback remains unknown, recovery can broadcast only those exact bytes while the finalized block height is within their validity period. An expired transaction, unavailable RPC or older record without bytes remains UNKNOWN; no new transaction is signed automatically.
- `verifyRegistryCommitment` checks Devnet's genesis hash, the finalized transaction, the expected program instruction and signer and the contents and owner of the commitment account. Genesis Anchor #000001 is a historical Memo transaction with a separate payload.

The existing worker enables its Registry pass when the operator configures `OSA_DURABLE_DEVNET_PROGRAM_ID`, `OSA_DURABLE_DEVNET_AUTHORITY` and `OSA_DURABLE_DEVNET_KEY_FILE` on the worker host. Use a private file containing the dedicated Devnet authority's Solana keypair and an initialized program ID. The pass checks the completed job against the worker's configured chat scope, persists the transaction intent before submitting and can rebroadcast the same signed bytes before expiry. It never signs a replacement automatically after an ambiguous result. The scoped Durable status endpoint exposes the readback. The dashboard treats finalization as verified only after a positive Registry readback.

## Evidence boundary

A local run on Ollama `qwen2.5:3b` completed as `exec_0e786865-2b4b-4b5c-bd6e-b3d69e26bac6`. The isolated test identity's ActionReceipt signature, ProofReceipt integrity and both Merkle inclusions passed. Its status was `NOT_ANCHORED`. The production UI and Registry finalization require evidence from the same production execution before they can be called verified.
