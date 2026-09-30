import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiState, handleApiRequest, loadAuthMode } from "../apps/api/src/index";
import { createDevExecution, DevExecution } from "../apps/api/src/server";
import { vercelApiPath } from "../apps/api/src/vercel";

// The single Vercel Function for the OSA API. vercel.json rewrites every API path here, so all routes share
// one process state. vercel.json sets OSA_AUTH_MODE=open so the preview dashboard runs missions without a login.
let state: ApiState | undefined;
let execution: DevExecution | undefined;

function getExecution(): DevExecution {
  if (!execution) execution = createDevExecution(process.env);
  return execution;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  request.url = vercelApiPath(request.url);
  const current = getExecution();
  state ??= new ApiState(undefined, undefined, undefined, loadAuthMode(process.env), undefined, current.brain);
  return handleApiRequest(request, response, current.registry, state, current.description);
}
