import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiState, handleApiRequest } from "../apps/api/src/index";
import { createDevExecution, DevExecution } from "../apps/api/src/server";

const state = new ApiState();
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
