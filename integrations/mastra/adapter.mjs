// Experimental Mastra -> OSA Proof mission adapter.
// This is a delegated tool handler, NOT a global tool security boundary.
// Do not use with the open-auth preview or untrusted external tools.
import { createHash } from "node:crypto";

export class OsaAdapterError extends Error {
  constructor(code, message) { super(message); this.name = "OsaAdapterError"; this.code = code; }
}
const sha = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const required = (x, name) => {
  if (typeof x !== "string" || !x.trim()) throw new OsaAdapterError("INVALID_INPUT", name + " required");
  return x;
};
export function createMastraOsaTool({ apiBaseUrl, token, fetchImpl = fetch, missionFactory }) {
  if (!apiBaseUrl || !/^https:\/\//.test(apiBaseUrl)) throw new OsaAdapterError("CONFIG", "HTTPS OSA API required");
  if (!token) throw new OsaAdapterError("CONFIG", "authenticated OSA API token required");
  if (typeof missionFactory !== "function") throw new OsaAdapterError("CONFIG", "missionFactory required");
  const base = apiBaseUrl.replace(/\/$/, "");
  const request = async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(base + path, {
        method,
        headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new OsaAdapterError("OSA_UNAVAILABLE", "OSA request failed"); }
    if (!response.ok) throw new OsaAdapterError("OSA_REJECTED", "OSA returned HTTP " + response.status);
    return response.json();
  };
  return async function execute({ mastraRunId, toolCallId, toolName, input }) {
    required(mastraRunId, "mastraRunId");
    required(toolCallId, "toolCallId");
    required(toolName, "toolName");
    // The factory must create an authorized, pinned Mission using an existing TeamGraph.
    const mission = missionFactory({ mastraRunId, toolCallId, toolName, input });
    if (!mission || typeof mission !== "object") throw new OsaAdapterError("INVALID_MISSION", "missionFactory returned no mission");
    const id = required(mission.mission_id, "mission_id");
    // POST /missions rejects duplicate IDs. No automatic retries of side-effecting POSTs.
    const created = await request("POST", "/missions", mission);
    if (created.mission_id !== id) throw new OsaAdapterError("BINDING_MISMATCH", "mission creation ID mismatch");
    const run = await request("POST", "/missions/" + encodeURIComponent(id) + "/run");
    if (!run.run_id || !run.execution_id || run.verdict !== "VERIFIED") {
      throw new OsaAdapterError("RUN_NOT_VERIFIED", "OSA run not verified");
    }
    const receipt = await request("GET", "/missions/" + encodeURIComponent(id) + "/receipt");
    if (receipt.schema !== "osa.mission_receipt.v1" || receipt.mission_id !== id) {
      throw new OsaAdapterError("RECEIPT_MISMATCH", "mission receipt does not match");
    }
    // IMPORTANT: this is correlation only; not independent cryptographic verification.
    return {
      schema: "osa.mastra.binding.v1",
      mastra_run_id: mastraRunId,
      mastra_tool_call_id: toolCallId,
      tool_name: toolName,
      input_sha256: sha(input),
      osa_mission_id: id,
      osa_run_id: run.run_id,
      osa_execution_id: run.execution_id,
      osa_verdict: run.verdict,
      mission_receipt_sha256: receipt.receipt_sha256 ?? null,
      verification: "CORRELATED_NOT_INDEPENDENTLY_VERIFIED",
      output: run.final_output,
    };
  };
}
