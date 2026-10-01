import { OSAEvent, WEB3_EVENT_TYPES, Web3Event, Web3Scope } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { assertScope, chain, object, safeMetadata, strings, text, timestamp, Web3Error } from "./context";
export function normalizeEvent(input: unknown, scope: Web3Scope): Web3Event {
  assertScope(scope); const e = object(input);
  if (!WEB3_EVENT_TYPES.includes(e.eventType as Web3Event["eventType"])) throw new Web3Error("WEB3_EVENT_TYPE_INVALID");
  if (!["RPC_VALIDATED", "LOCAL_OBSERVATION"].includes(String(e.confidence))) throw new Web3Error("WEB3_EVENT_CONFIDENCE_INVALID");
  const position = (v: unknown): number | null => { if (v == null) return null; if (!Number.isSafeInteger(v) || Number(v) < 0) throw new Web3Error("WEB3_EVENT_POSITION_INVALID"); return Number(v); };
  const body = { eventType: e.eventType as Web3Event["eventType"], chain: chain(e.chain), entityRefs: strings(e.entityRefs ?? []),
    transactionRef: e.transactionRef == null ? null : text(e.transactionRef), slot: position(e.slot), block: position(e.block),
    timestamp: timestamp(e.timestamp), payload: safeMetadata(e.payload ?? {}), source: text(e.source), confidence: e.confidence as Web3Event["confidence"],
    context: structuredClone(scope) };
  // Chain observations have stable identities across repeated polling, independent of observation time.
  const identity = body.transactionRef ? { scope, chain: body.chain, eventType: body.eventType, transactionRef: body.transactionRef, payload: body.payload } : body;
  return { ...body, eventId: `web3_event_${digest(identity)}`, proofRef: e.proofRef == null ? null : text(e.proofRef) };
}
export function deduplicateEvents(events: Web3Event[]): Web3Event[] {
  const seen = new Map<string, Web3Event>();
  for (const e of events) {
    const previous = seen.get(e.eventId);
    if (previous && digest({ ...previous, timestamp: null, proofRef: null }) !== digest({ ...e, timestamp: null, proofRef: null })) throw new Web3Error("WEB3_EVENT_ID_CONFLICT");
    if (!previous) seen.set(e.eventId, structuredClone(e));
  }
  return [...seen.values()].sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId));
}
export function toOSAEvent(event: Web3Event, correlationId: string): OSAEvent {
  return { event_id: event.eventId, event_type: `WEB3.${event.eventType}`, mission_id: event.context.mission_id,
    tenant_id: event.context.organization_id, source: event.source, subject: event.transactionRef ?? event.entityRefs[0] ?? "web3",
    timestamp: event.timestamp, correlation_id: correlationId, payload: structuredClone(event) as unknown as Record<string, unknown>, evidence: event.proofRef ? [event.proofRef] : [] };
}

/** In-process domain dispatcher. Durable source remains sealed OSA execution evidence. */
export class Web3EventBus {
  private readonly seen = new Map<string, OSAEvent>();
  private readonly listeners = new Set<{ scope: Web3Scope; receive: (event: OSAEvent) => void }>();
  subscribe(scope: Web3Scope, receive: (event: OSAEvent) => void): () => void {
    assertScope(scope); const entry = { scope: structuredClone(scope), receive }; this.listeners.add(entry);
    return () => { this.listeners.delete(entry); };
  }
  publish(event: Web3Event, correlationId: string): { envelope: OSAEvent; duplicate: boolean; listenerFailures: number } {
    const normalized = normalizeEvent(event,event.context); const envelope = toOSAEvent(normalized,correlationId);
    const previous = this.seen.get(normalized.eventId);
    if (previous) return { envelope: structuredClone(previous), duplicate: true, listenerFailures: 0 };
    // This cache is bounded; subscribers must retain event_id for durable deduplication across restarts.
    if (this.seen.size >= 2000) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(normalized.eventId,envelope); let listenerFailures = 0;
    for (const entry of this.listeners) if (entry.scope.organization_id === normalized.context.organization_id && entry.scope.project_id === normalized.context.project_id && entry.scope.mission_id === normalized.context.mission_id) {
      try { entry.receive(structuredClone(envelope)); } catch { listenerFailures++; }
    }
    return { envelope: structuredClone(envelope), duplicate: false, listenerFailures };
  }
  replay(events: Web3Event[], correlationId: string) { return deduplicateEvents(events).map(event => this.publish(event,correlationId)); }
}
