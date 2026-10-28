import { createConfiguredWeb3 } from "../packages/web3/src";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiState, handleApiRequest, loadAuthMode } from "../apps/api/src/index";
import { createDevExecution, type DevExecution } from "../apps/api/src/server";
import { vercelApiPath } from "../apps/api/src/vercel";
import { BrainControlPlane } from "../packages/brain/src";
import { PreviewOperator } from "../apps/api/src/preview-operator";
import { githubOAuthConfigured } from "../apps/api/src/github-auth";

// Keep private NeurOSA off custom/production domains, even when those domains
// happen to alias the same Vercel deployment as this PR Preview.
const PRIVATE_PREVIEW_HOST = "osa-proof-git-codex-neurosa-chat-memory-osabarca-1680s-projects.vercel.app";
// Isolated, branch-scoped preview for the Final Boss integration. Never a public alias.
const PATCH_PREVIEW_BRANCH = "fix/osa-proof-neurosa-protected-preview-20261028";
const STAGING_MEMORY_PREVIEW_BRANCH = "test/osa-proof-neurosa-live-e2e-20261028";
const PRIVATE_PRODUCTION_HOST = "osa-proof-three.vercel.app";
export function isNeurosaAuthenticatedProduction(
  host: string | undefined, env: Record<string, string | undefined>,
  forwardedHost?: string | string[]
): boolean {
  if(env.OSA_NEUROSA_PRODUCTION_ENABLED !== "enabled" || env.VERCEL_ENV !== "production") return false;
  if(typeof host !== "string" || host.toLowerCase() !== PRIVATE_PRODUCTION_HOST) return false;
  if(forwardedHost !== undefined &&
      (typeof forwardedHost !== "string" || forwardedHost.toLowerCase() !== PRIVATE_PRODUCTION_HOST)) return false;
  // Only a signed, allowlisted GitHub session can receive private memory.
  // The storage proof must be accepted separately after real restart/readback.
  if(env.VERCEL !== "1" || env.OSA_AUTH_MODE !== "session" ||
    env.OSA_NEUROSA_STORAGE_VERIFIED !== "true" || !githubOAuthConfigured(env) ||
    !env.OSA_NEUROSA_ORGANIZATION_ID || !env.OSA_NEUROSA_PROJECT_ID ||
    (env.OSA_GITHUB_ORGANIZATION_ID ?? env.OSA_NEUROSA_ORGANIZATION_ID) !== env.OSA_NEUROSA_ORGANIZATION_ID ||
    (env.OSA_GITHUB_PROJECT_ID ?? env.OSA_NEUROSA_PROJECT_ID) !== env.OSA_NEUROSA_PROJECT_ID)
    throw new Error("NEUROSA_PRODUCTION_GATE_BLOCKED");
  return true;
}
export function isNeurosaProtectedPreview(
  host: string | undefined,
  env: Record<string, string | undefined>,
  forwardedHost?: string | string[]
): boolean {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
      env.OSA_PREVIEW_SINGLE_OPERATOR !== "enabled") return false;
  // Accept either the original fixed private alias, or ONLY Vercel's generated
  // deployment hostname for our isolated integration branch. Never a custom,
  // branch, or production alias for this new operator.
  const protectedHost = env.VERCEL_GIT_COMMIT_REF === "codex/neurosa-chat-memory"
    ? PRIVATE_PREVIEW_HOST
    : [PATCH_PREVIEW_BRANCH, STAGING_MEMORY_PREVIEW_BRANCH].includes(env.VERCEL_GIT_COMMIT_REF ?? "") &&
      typeof env.VERCEL_URL === "string" &&
      /^osa-proof-[a-z0-9-]+\.vercel\.app$/i.test(env.VERCEL_URL)
      ? env.VERCEL_URL.toLowerCase() : undefined;
  if (!protectedHost || typeof host !== "string" || host.toLowerCase() !== protectedHost) return false;
  if (forwardedHost !== undefined &&
      (typeof forwardedHost !== "string" || forwardedHost.toLowerCase() !== protectedHost)) return false;
  return true;
}

// A Vercel Function instance may serve several aliases for the same deployment.
// Each access class must have its own immutable API state; never let a request on
// agentworlds.dev inherit the protected operator/memory from a branch-alias request.
const states = new Map<string, ApiState>();
let execution: DevExecution | undefined;
function getExecution(): DevExecution {
  execution ??= createDevExecution(process.env);
  return execution;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  request.url = vercelApiPath(request.url);
  const current = getExecution();
  const preview = process.env.VERCEL_ENV === "preview";
  const privatePreview = isNeurosaProtectedPreview(
    request.headers.host, process.env, request.headers["x-forwarded-host"]
  );
  const privateProduction = isNeurosaAuthenticatedProduction(
    request.headers.host, process.env, request.headers["x-forwarded-host"]
  );
  const kind = privatePreview ? "preview-private" : privateProduction ? "production-private" : preview ? "preview-public" : "other-environment";
  let state = states.get(kind);
  if (!state) {
    // Browser requests to the protected alias need no GitHub OAuth. The operator
    // session is created on the server, pinned to the configured NeurOSA scope.
    const operator = privatePreview ? PreviewOperator.fromEnvironment(process.env) : undefined;
    if (privatePreview && !operator) throw new Error("Protected Preview operator is not configured");
    // Keep host-specific isolated API states: neither agentworlds.dev nor unrelated Preview
    // can ever inherit another host's private Brain, even within the same Lambda instance.
    const brain = privatePreview || privateProduction ? current.brain : new BrainControlPlane(current.brain.planner);
    state = new ApiState(undefined, undefined, undefined, loadAuthMode(process.env),
      undefined, brain, createConfiguredWeb3(process.env), operator);
    states.set(kind, state);
  }
  return handleApiRequest(request, response, current.registry, state, current.description);
}
