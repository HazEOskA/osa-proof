// Mastra 1.x tool factory. Requires @mastra/core and zod in the consuming project.
// Mastra docs: createTool({ id, inputSchema, execute(inputData, context) }).
// This is an SDK integration source file; SDK execution has not been verified here.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createMastraOsaTool } from "./adapter.mjs";

export function createOsaDelegationTool(options) {
  const delegate = createMastraOsaTool(options);
  return createTool({
    id: "osa-verified-delegation",
    description: "Delegate an approved fixture mission to OSA Proof and return evidence-bound execution metadata.",
    inputSchema: z.object({
      task: z.string().min(1).max(512),
    }),
    // Human approval is a second safeguard, not a replacement for OSA authorization.
    requireApproval: true,
    execute: async (inputData, context) => {
      // Trusted server code must set these requestContext values. Never take them from model input.
      const mastraRunId = context?.requestContext?.get("osaMastraRunId");
      const toolCallId = context?.requestContext?.get("osaToolCallId");
      if (typeof mastraRunId !== "string" || typeof toolCallId !== "string") {
        throw new Error("OSA_CORRELATION_CONTEXT_MISSING");
      }
      return delegate({
        mastraRunId,
        toolCallId,
        toolName: "osa-verified-delegation",
        input: inputData,
      });
    },
  });
}
