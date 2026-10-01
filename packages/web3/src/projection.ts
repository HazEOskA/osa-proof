import { EvidenceRecord, Web3Scope, Web3WorldState } from "../../contracts/src";
import { normalizeEntity } from "./entities";
import { deduplicateEvents, normalizeEvent } from "./events";
import { validateWeb3Evidence } from "./proof";
import { object, sameScope, Web3Error } from "./context";
export function projectEvidence(evidence: EvidenceRecord[], scope: Web3Scope): Web3WorldState {
  const entities = new Map<string, Web3WorldState["entities"][number]>(); const events: Web3WorldState["events"] = []; const proofRefs: string[] = [];
  for (const record of evidence.filter(e => e.kind === "web3_observation")) {
    validateWeb3Evidence(record, scope); const world = object(record.data.finalState);
    if (!Array.isArray(world.entities) || !Array.isArray(world.events)) throw new Web3Error("WEB3_PROJECTION_INVALID");
    proofRefs.push(record.evidence_id);
    for (const input of world.entities) {
      const raw = object(input); if (!sameScope(object(raw.context) as unknown as Web3Scope, scope)) throw new Web3Error("WEB3_PROJECTION_SCOPE_DENIED");
      const e = normalizeEntity(raw, scope); const previous = entities.get(e.id);
      entities.set(e.id, { ...e, createdAt: previous?.createdAt ?? e.createdAt, proofRefs: [...new Set([...(previous?.proofRefs ?? []), ...e.proofRefs, record.evidence_id])] });
    }
    for (const input of world.events) {
      const raw = object(input); if (!sameScope(object(raw.context) as unknown as Web3Scope, scope)) throw new Web3Error("WEB3_PROJECTION_SCOPE_DENIED");
      events.push(normalizeEvent({ ...raw, proofRef: record.evidence_id }, scope));
    }
  }
  const relations: Web3WorldState["relations"] = [];
  for (const e of entities.values()) for (const owner of e.ownership) if (entities.has(owner)) relations.push({ from: owner, to: e.id, type: "owns" });
  for (const event of deduplicateEvents(events)) if (event.transactionRef) {
    const tx = [...entities.values()].find(e => e.type === "Transaction" && e.identifier === event.transactionRef);
    if (tx) for (const ref of event.entityRefs) if (entities.has(ref) && ref !== tx.id) relations.push({ from: tx.id, to: ref, type: "interactedWith" });
  }
  return { entities: [...entities.values()].sort((a,b) => a.id.localeCompare(b.id)), events: deduplicateEvents(events), relations: [...new Map(relations.map(r => [`${r.from}|${r.to}|${r.type}`,r])).values()], proofRefs: [...new Set(proofRefs)] };
}
