import type { BrainMemoryContext, MemoryEvent } from "../../contracts/src";
import { digest, digestWithout } from "../../proof-core/src/canonical";
import { BrainPlanningError } from "./plan";

export function sealMemoryEvent(body: Omit<MemoryEvent, "schema" | "event_sha256">): MemoryEvent {
  const event = structuredClone({ schema: "osa.memory_event.v1" as const, scope: body.scope, kind: body.kind,
    verification_scope: body.verification_scope, data: body.data });
  return { ...event, event_sha256: digest(event) };
}

export function verifyMemoryEvent(event: MemoryEvent): void {
  if (!event || event.schema !== "osa.memory_event.v1" || !event.scope ||
      ![event.scope.organization_id, event.scope.project_id, event.scope.mission_id].every(v => typeof v === "string" && v.length > 0 && v.length <= 200) ||
      !["AUTHENTICATED_USER_STATEMENT", "VERIFIED_RUNTIME", "CHAT_PROVENANCE", "DIAGNOSTIC_TEST"].includes(event.kind) ||
      typeof event.verification_scope !== "string" || !event.verification_scope ||
      !event.data || typeof event.data !== "object" || Array.isArray(event.data) ||
      event.event_sha256 !== digestWithout(event, "event_sha256")) throw new BrainPlanningError("MEMORY_EVENT_REJECTED");
  if (event.kind === "DIAGNOSTIC_TEST") {
    const nonce = event.data.nonce;
    if (event.data.run_kind !== "NEUROSA_LIVE_E2E_V1" ||
        typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce) ||
        event.data.statement !== `NEUROSA_DIAGNOSTIC_${nonce}` ||
        Object.keys(event.data).sort().join(",") !== "nonce,run_kind,statement")
      throw new BrainPlanningError("MEMORY_EVENT_REJECTED");
  }
  if (event.kind === "CHAT_PROVENANCE") {
    const memory = event.data.memory as BrainMemoryContext;
    const response = event.data.response as { text?: unknown; request_sha256?: unknown } | undefined;
    verifyMemoryContext(memory);
    if (digest(memory.scope) !== digest(event.scope) || typeof response?.text !== "string" ||
        typeof response.request_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(response.request_sha256) ||
        event.data.response_sha256 !== digest(response.text)) throw new BrainPlanningError("MEMORY_EVENT_REJECTED");
  }
}

export function verifyMemoryContext(context: BrainMemoryContext): void {
  if (!context || typeof context.text !== "string" || !context.brain_id || !context.ledger_head ||
      !Array.isArray(context.references) || typeof context.truncated !== "boolean" ||
      context.context_sha256 !== digestWithout(context, "context_sha256")) throw new BrainPlanningError("MEMORY_CONTEXT_REJECTED");
}
