import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiState, handleApiRequest, loadAuthMode } from "../apps/api/src/index";
import { createDevExecution, DevExecution } from "../apps/api/src/server";

// vercel.json sets OSA_AUTH_MODE=open so the preview dashboard runs missions without a login.
const state = new ApiState(undefined, undefined, undefined, loadAuthMode(process.env));
let execution: DevExecution | undefined;

function getExecution(): DevExecution {
  if (!execution) execution = createDevExecution(process.env);
  return execution;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url?.startsWith("/api/")) {
    request.url = request.url.slice(4) || "/";
  }
  return handleApiRequest(request, response, getExecution().registry, state);
}
