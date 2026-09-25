# Proof Protocol v1

## Principle

**CLAIM != PROOF**

A claim is an assertion that work was completed.
Proof requires evidence that satisfies explicit requirements.

## Execution states

A proof-required mission may resolve to:

- `VERIFIED`
- `FAILED`
- `INCOMPLETE`

`VERIFIED` MUST NOT be produced solely from model output or agent self-reporting.

## Minimal protocol objects

### Claim

A Claim contains:

- claim ID,
- mission ID,
- claimant/agent,
- asserted result,
- requirement reference.

### Evidence

Evidence contains:

- evidence ID,
- mission/run ID,
- producer,
- type,
- immutable or content-addressable reference where possible,
- relevant metadata,
- collection timestamp/order.

Examples include:

- test output,
- artifact hash,
- file diff,
- HTTP response,
- tool result,
- runtime event,
- deployment receipt.

### Verification

A Verification binds:

- one or more claims,
- one or more evidence records,
- verifier,
- rule/acceptance requirement,
- verdict,
- reason.

### Proof Receipt

The final receipt contains at minimum:

- proof/run ID,
- mission ID,
- Team Graph version,
- final verdict,
- requirement verdicts,
- evidence references,
- verifier metadata,
- timestamps.

## Trust rule

The verifier must evaluate evidence against mission requirements.
A UI label, natural-language completion message, or agent confidence score is not evidence by itself.

## Framework neutrality

The Proof Protocol must accept evidence produced by:

- OSA Runtime,
- framework adapters,
- external runtimes,
- tools/services,

provided the evidence satisfies the configured verification policy.

## Vertical Slice #1

For the first slice, the protocol only needs:

1. runtime action/event evidence,
2. final artifact/result evidence,
3. explicit acceptance requirement,
4. deterministic verification result,
5. proof receipt with VERIFIED or non-VERIFIED outcome.
