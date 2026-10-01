import { WEB3_ENTITY_TYPES, Web3Entity, Web3Scope } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { assertScope, chain, object, safeMetadata, strings, text, timestamp, Web3Error } from "./context";
export function normalizeEntity(input: unknown, scope: Web3Scope): Web3Entity {
  assertScope(scope); const e = object(input); const c = chain(e.chain);
  if (!WEB3_ENTITY_TYPES.includes(e.type as Web3Entity["type"])) throw new Web3Error("WEB3_ENTITY_TYPE_INVALID");
  const identifier = text(e.identifier ?? e.address); const type = e.type as Web3Entity["type"];
  const createdAt = timestamp(e.createdAt); const updatedAt = timestamp(e.updatedAt ?? createdAt);
  if (updatedAt < createdAt) throw new Web3Error("WEB3_ENTITY_TIME_INVALID");
  return { id: `web3_entity_${digest({ scope, chain: c, type, identifier })}`, type, chain: c, identifier,
    ...(e.address === undefined ? {} : { address: text(e.address) }), metadata: safeMetadata(e.metadata ?? {}),
    ownership: strings(e.ownership ?? []), context: structuredClone(scope), tags: strings(e.tags ?? []),
    createdAt, updatedAt, proofRefs: strings(e.proofRefs ?? []) };
}
