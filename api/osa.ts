import { createConfiguredWeb3 } from "../packages/web3/src";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiState, handleApiRequest, loadAuthMode } from "../apps/api/src/index";
import { createDevExecution, DevExecution } from "../apps/api/src/server";
import { vercelApiPath } from "../apps/api/src/vercel";

// The single Vercel Function for the OSA API. vercel.json rewrites every API path here, so all routes share
// process-local state only. Explicit open mode skips the panel login; cloud model calls keep operator authorization.
let state: ApiState | undefined;
let execution: DevExecution | undefined;

function getExecution(): DevExecution {
  if (!execution) execution = createDevExecution(process.env);
  return execution;
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  request.url = vercelApiPath(request.url);
  const current = getExecution();
  state ??= new ApiState(undefined, undefined, undefined, loadAuthMode(process.env), undefined, current.brain, createConfiguredWeb3(process.env));
  return handleApiRequest(request, response, current.registry, state, current.description);
}
