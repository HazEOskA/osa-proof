import { ModelHop, ModelProvider, ModelRequest, ModelResponse, ProviderCallError } from "./provider";

// Model Mesh: ordered fallback across model targets (LiteLLM "fallbacks" pattern).
// Each target is a gateway provider that already applied its own bounded retries; the mesh moves to the
// next target only after the previous one failed with a ProviderCallError. Programming errors are never
// swallowed. The response lists every hop, so the serving model and each failed hop become evidence.
export class ModelMesh implements ModelProvider {
  readonly id: string;
  readonly model: string;

  constructor(private readonly targets: ModelProvider[]) {
    if (targets.length === 0) throw new RangeError("model mesh needs at least one target");
    this.id = targets[0].id;
    this.model = targets[0].model;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const hops: ModelHop[] = [];
    for (const target of this.targets) {
      try {
        const response = await target.complete(request);
        hops.push({ provider: target.id, model: target.model, ok: true, attempts: response.attempts ?? 1 });
        return { ...response, hops };
      } catch (error) {
        if (!(error instanceof ProviderCallError)) throw error;
        hops.push({ provider: target.id, model: target.model, ok: false, attempts: error.attempts ?? 1, error: error.message });
      }
    }
    throw new ProviderCallError(
      `model mesh exhausted ${hops.length} targets: ${hops.map((h) => `${h.provider}/${h.model}: ${h.error}`).join(" | ")}`,
      { retryable: false }
    );
  }
}
