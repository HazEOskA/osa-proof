import { createConfiguredWeb3 } from "../packages/web3/src";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiState, handleApiRequest, loadAuthMode } from "../apps/api/src/index";
import { createDevExecution, type DevExecution } from "../apps/api/src/server";
import { vercelApiPath } from "../apps/api/src/vercel";
import { BrainControlPlane } from "../packages/brain/src";
import { PreviewOperator } from "../apps/api/src/preview-operator";

// Keep private NeurOSA off custom/production domains, even when those domains
// happen to alias the same Vercel deployment as this PR Preview.
const PRIVATE_PREVIEW_HOST = "osa-proof-git-codex-neurosa-chat-memory-osabarca-1680s-projects.vercel.app";
export function isNeurosaProtectedPreview(
  host: string | undefined,
  env: Record<string, string | undefined>,
  forwardedHost?: string | string[]
): boolean {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
      env.OSA_PREVIEW_SINGLE_OPERATOR !== "enabled") return false;
  if (typeof host !== "string" || host.toLowerCase() !== PRIVATE_PREVIEW_HOST) return false;
  if (forwardedHost !== undefined &&
      (typeof forwardedHost !== "string" || forwardedHost.toLowerCase() !== PRIVATE_PREVIEW_HOST)) return false;
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
  const kind = privatePreview ? "preview-private" : preview ? "preview-public" : "other-environment";
  let state = states.get(kind);
  if (!state) {
    // Browser requests to the protected alias need no GitHub OAuth. The operator
    // session is created on the server, pinned to the configured NeurOSA scope.
    const operator = privatePreview ? PreviewOperator.fromEnvironment(process.env) : undefined;
    if (privatePreview && !operator) throw new Error("Protected Preview operator is not configured");
    // Never mount private memory outside the one protected Preview host.
    // This includes custom-domain aliases and accidental Production routing.
    const brain = privatePreview ? current.brain : new BrainControlPlane(current.brain.planner);
    state = new ApiState(undefined, undefined, undefined, loadAuthMode(process.env),
      undefined, brain, createConfiguredWeb3(process.env), operator);
    states.set(kind, state);
  }
  return handleApiRequest(request, response, current.registry, state, current.description);
}
