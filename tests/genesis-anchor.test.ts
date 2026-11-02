import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenesisAnchorMemo,
  GENESIS_AGENT_AI_ID,
  MAX_DEVNET_AIRDROP_LAMPORTS,
  validateGenesisAnchorInput,
} from "../packages/web3/src/solana/genesis-anchor";

const input = {
  agent_ai_id: GENESIS_AGENT_AI_ID,
  merkle_root: "6d3bc05a9ba5fd1f803444fc9674f8b94db062bbaa8d38609f278d4eaefdbe96",
  proof_receipt_digest: "bd4bfbc7e50b36f21b83b8e27871d86cfc32c4e09d7d36b8a83cbfbdd9608ebd",
  artifact_digest: "b93fd5a1c54d89598ab74f52bfbeaaa4f47bef64317c2ab6649bc03fec6f6018",
};

test("Genesis Anchor payload contains only the approved identity and proof digests", () => {
  validateGenesisAnchorInput(input);
  assert.equal(MAX_DEVNET_AIRDROP_LAMPORTS, 10_000_000n);
  assert.equal(
    buildGenesisAnchorMemo(input),
    [
      "OSA|GENESIS|000001",
      "agent:@ai:osatechgpt.dev/agents/genesis",
      "merkle:6d3bc05a9ba5fd1f803444fc9674f8b94db062bbaa8d38609f278d4eaefdbe96",
      "proof:bd4bfbc7e50b36f21b83b8e27871d86cfc32c4e09d7d36b8a83cbfbdd9608ebd",
      "artifact:b93fd5a1c54d89598ab74f52bfbeaaa4f47bef64317c2ab6649bc03fec6f6018",
    ].join("\n")
  );
});

test("Genesis Anchor rejects wrong identity or malformed digests before any network write", () => {
  assert.throws(() => validateGenesisAnchorInput({ ...input, agent_ai_id: "@ai:evil.example/agent" }));
  assert.throws(() => validateGenesisAnchorInput({ ...input, merkle_root: "00" }));
});
