import type { BrainMemory, BrainMemoryContext, BrainScope, MemoryWriteReceipt, SessionRecord, WritableBrainMemory } from "../../../packages/contracts/src";
import { sealMemoryEvent, verifyMemoryContext } from "../../../packages/brain/src/memory";
import { canonicalJson, digest } from "../../../packages/proof-core/src/canonical";

export class MemoryAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

// A dev identity is self-asserted. Only a trusted server-side identity integration
// may populate project_ids; accepting a project supplied by the browser is unsafe.
export function requireMemoryIdentity(memory: BrainMemory, session?: SessionRecord): void {
  const identity = session?.identity;
  if (!identity || identity.verified !== true || !["github", "google", "microsoft", "vercel-preview"].includes(identity.provider) ||
      !identity.subject || !identity.identity_id || !(Date.parse(session!.expires_at) > Date.now()))
    throw new MemoryAccessError(401, "MEMORY_IDENTITY_REQUIRED", "Pamięć wymaga potwierdzonej tożsamości. Konto developerskie nie daje dostępu.");
  if (!memory.binding || identity.organization_id !== memory.binding.organization_id ||
      !Array.isArray(identity.project_ids) || !identity.project_ids.includes(memory.binding.project_id))
    throw new MemoryAccessError(403, "MEMORY_SCOPE_DENIED", "Brak dostępu do pamięci tej organizacji i projektu.");
}

function writable(memory: BrainMemory): WritableBrainMemory {
  const value = memory as Partial<WritableBrainMemory>;
  if (!value.binding || typeof value.probe !== "function" || typeof value.observe !== "function" || typeof value.readEvent !== "function")
    throw new MemoryAccessError(503, "MEMORY_WRITE_UNAVAILABLE", "Zapis pamięci nie jest skonfigurowany.");
  return value as WritableBrainMemory;
}

export class MemoryService {
  constructor(readonly adapter?: BrainMemory) {}
  authorize(session?: SessionRecord): void { if (this.adapter) requireMemoryIdentity(this.adapter, session); }
  scope(session: SessionRecord, missionId: string): BrainScope {
    if (!this.adapter) throw new MemoryAccessError(503, "MEMORY_UNCONFIGURED", "Pamięć NeurOSA nie jest skonfigurowana.");
    requireMemoryIdentity(this.adapter, session);
    return { ...this.adapter.binding!, mission_id: missionId };
  }
  async status(session?: SessionRecord) {
    if (!this.adapter) return { state: "UNCONFIGURED", message: "Pamięć NeurOSA nie jest skonfigurowana.", persistence_verified: false };
    try { this.authorize(session); }
    catch { return { state: "ACCESS_REQUIRED", message: "Pamięć wymaga potwierdzonego dostępu do organizacji i projektu.", persistence_verified: false }; }
    const checked_at = new Date().toISOString();
    try {
      const probe = await writable(this.adapter).probe(this.scope(session!, "memory-status"));
      return { state: "AVAILABLE", message: "NeurOSA odpowiada; trwałość po restarcie wymaga osobnego testu.", ...probe, checked_at, persistence_verified: false };
    } catch { return { state: "UNAVAILABLE", message: "Nie udało się potwierdzić dostępności lub integralności pamięci.", checked_at, persistence_verified: false }; }
  }
  async remember(session: SessionRecord, conversationId: string, text: string): Promise<MemoryWriteReceipt> {
    const scope = this.scope(session, `chat_${conversationId}`);
    const event = sealMemoryEvent({ scope, kind: "AUTHENTICATED_USER_STATEMENT",
      verification_scope: "Potwierdzono autora i przyjęcie informacji; nie potwierdzono prawdziwości jej treści.",
      data: { subject: session.identity.subject, text } });
    return writable(this.adapter!).observe(event);
  }
  async recall(session: SessionRecord, conversationId: string, prompt: string): Promise<BrainMemoryContext> {
    const scope = this.scope(session, `chat_${conversationId}`);
    const context = await this.adapter!.recall(scope, prompt, 12000);
    verifyMemoryContext(context);
    if (digest(context.scope) !== digest(scope) || context.text.length > 12000 || Buffer.byteLength(canonicalJson(context)) > 65536)
      throw new MemoryAccessError(502, "MEMORY_CONTEXT_REJECTED", "Odrzucono nieprawidłowy lub zbyt duży kontekst pamięci.");
    return context;
  }
  async recordAnswer(session: SessionRecord, context: BrainMemoryContext, prompt: string,
    answer: { text: string; model: string; provider_response_id: string | null; request_id: string; request_sha256: string }, remembered?: MemoryWriteReceipt) {
    this.authorize(session);
    const event = sealMemoryEvent({ scope: context.scope, kind: "CHAT_PROVENANCE",
      verification_scope: "Pochodzenie kontekstu i integralność odpowiedzi; nie semantyczna prawdziwość odpowiedzi modelu.",
      data: { subject: session.identity.subject, prompt_sha256: digest(prompt), memory: context,
        response: { text: answer.text, model: answer.model, provider_response_id: answer.provider_response_id, request_id: answer.request_id, request_sha256: answer.request_sha256 },
        response_sha256: digest(answer.text), ...(remembered ? { remembered } : {}) } });
    const receipt = await writable(this.adapter!).observe(event);
    return { context, receipt, ...(remembered ? { remembered } : {}) };
  }
  async recordExecution(session: SessionRecord, execution: { mission: { mission_id: string; organization_id: string; project_id: string }; run: { execution_id: string; verdict: string; proof: { receipt_sha256: string } }; integrity: { ok: boolean }; tool: string }) {
    const scope = this.scope(session, execution.mission.mission_id);
    if (execution.mission.organization_id !== scope.organization_id || execution.mission.project_id !== scope.project_id ||
        execution.run.verdict !== "VERIFIED" || !execution.integrity.ok)
      throw new MemoryAccessError(403, "MEMORY_EVENT_REJECTED", "Zapis pamięci wymaga zweryfikowanego wykonania w tym samym zakresie.");
    return writable(this.adapter!).observe(sealMemoryEvent({ scope, kind: "VERIFIED_RUNTIME",
      verification_scope: "Integralność dowodu wykonania narzędzia OSA.", data: { execution_id: execution.run.execution_id,
        tool: execution.tool, proof_receipt_sha256: execution.run.proof.receipt_sha256 } }));
  }
  async read(session: SessionRecord, documentId: string) {
    const scope = this.scope(session, "memory-receipt-read");
    return writable(this.adapter!).readEvent(scope, documentId);
  }
}
