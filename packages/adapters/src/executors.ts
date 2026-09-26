import { createHash } from "node:crypto";
import { AgentExecutor, EvidenceInput } from "../../contracts/src";
import { ModelProvider, ModelResponse } from "./provider";

// CLAIM != PROOF: the model only supplies content. Every evidence `status` below is
// decided by this code from the parsed, validated response; model fields such as
// "status" are never copied into evidence.

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "steps"],
  additionalProperties: false,
};

const ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    content: { type: "string" },
  },
  required: ["title", "content"],
  additionalProperties: false,
};

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

interface Plan {
  summary: string;
  steps: string[];
}

interface Artifact {
  title: string;
  content: string;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseObject(text: string): Parsed<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "response is not valid JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "response is not a JSON object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function parsePlan(text: string): Parsed<Plan> {
  const parsed = parseObject(text);
  if (!parsed.ok) return parsed;
  const { summary, steps } = parsed.value;
  if (!nonEmptyString(summary)) return { ok: false, reason: "plan.summary must be a non-empty string" };
  if (!Array.isArray(steps) || steps.length === 0 || !steps.every(nonEmptyString)) {
    return { ok: false, reason: "plan.steps must be a non-empty array of non-empty strings" };
  }
  return { ok: true, value: { summary, steps } };
}

function parseArtifact(text: string): Parsed<Artifact> {
  const parsed = parseObject(text);
  if (!parsed.ok) return parsed;
  const { title, content } = parsed.value;
  if (!nonEmptyString(title)) return { ok: false, reason: "artifact.title must be a non-empty string" };
  if (!nonEmptyString(content)) return { ok: false, reason: "artifact.content must be a non-empty string" };
  return { ok: true, value: { title, content } };
}

function providerCallEvidence(response: ModelResponse): EvidenceInput {
  return {
    kind: "provider_call",
    data: {
      status: "ok",
      provider: response.provider,
      model: response.model,
      response_id: response.response_id,
      http_status: response.http_status,
      stop_reason: response.stop_reason,
      usage: { ...response.usage },
      latency_ms: response.latency_ms,
      request_sha256: response.request_sha256,
      response_sha256: response.response_sha256,
    },
  };
}

function providerRef(response: ModelResponse) {
  return {
    source: "provider",
    provider: response.provider,
    model: response.model,
    response_id: response.response_id,
  };
}

export function createProviderPlannerExecutor(provider: ModelProvider): AgentExecutor {
  return async ({ mission, agent, input }) => {
    const response = await provider.complete({
      system:
        `You are the ${agent.role} agent in an OSA team. ` +
        "Produce a short, concrete plan for the objective. Respond only with JSON matching the schema.",
      prompt: JSON.stringify({ objective: mission.objective, input }),
      output_schema: PLAN_SCHEMA,
    });

    const plan = parsePlan(response.text);
    const evidence: EvidenceInput[] = [providerCallEvidence(response)];

    if (!plan.ok) {
      evidence.push({
        kind: "plan",
        data: { status: "rejected", reason: plan.reason, objective: mission.objective, ...providerRef(response) },
      });
      return { output: { plan: null, plan_rejected: plan.reason, objective: mission.objective, received: input }, evidence };
    }

    evidence.push({
      kind: "plan",
      data: {
        status: "ready",
        step_count: plan.value.steps.length,
        objective: mission.objective,
        ...providerRef(response),
      },
    });
    return { output: { plan: plan.value, objective: mission.objective, received: input }, evidence };
  };
}

function upstreamPlan(input: unknown): Plan | undefined {
  if (!input || typeof input !== "object") return undefined;
  const plan = (input as { plan?: unknown }).plan;
  if (!plan || typeof plan !== "object") return undefined;
  const { summary, steps } = plan as Record<string, unknown>;
  if (!nonEmptyString(summary) || !Array.isArray(steps) || !steps.every(nonEmptyString)) return undefined;
  return { summary, steps };
}

export function createProviderBuilderExecutor(provider: ModelProvider): AgentExecutor {
  return async ({ mission, agent, input }) => {
    const plan = upstreamPlan(input);
    if (!plan) {
      return {
        output: { artifact: null, objective: mission.objective, upstream: input },
        evidence: [
          {
            kind: "artifact",
            data: { status: "rejected", reason: "upstream plan missing or rejected", objective: mission.objective },
          },
        ],
      };
    }

    const response = await provider.complete({
      system:
        `You are the ${agent.role} agent in an OSA team. ` +
        "Build the artifact described by the plan. Respond only with JSON matching the schema.",
      prompt: JSON.stringify({ objective: mission.objective, plan }),
      output_schema: ARTIFACT_SCHEMA,
    });

    const artifact = parseArtifact(response.text);
    const evidence: EvidenceInput[] = [providerCallEvidence(response)];

    if (!artifact.ok) {
      evidence.push({
        kind: "artifact",
        data: { status: "rejected", reason: artifact.reason, objective: mission.objective, ...providerRef(response) },
      });
      return { output: { artifact: null, artifact_rejected: artifact.reason, objective: mission.objective, upstream: input }, evidence };
    }

    const bytes = Buffer.byteLength(artifact.value.content, "utf8");
    const contentSha256 = createHash("sha256").update(artifact.value.content, "utf8").digest("hex");

    // "built" = provider call completed, response parsed, structural contract passed,
    // non-empty content exists, and the hash was computed from that content.
    // It does not assert quality or semantic correctness.
    evidence.push({
      kind: "artifact",
      data: {
        status: "built",
        title: artifact.value.title,
        content_sha256: contentSha256,
        bytes,
        objective: mission.objective,
        ...providerRef(response),
      },
    });

    return {
      output: {
        artifact: { ...artifact.value, content_sha256: contentSha256, bytes },
        objective: mission.objective,
        upstream: input,
      },
      evidence,
    };
  };
}
