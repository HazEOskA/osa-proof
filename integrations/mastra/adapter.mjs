import { createHash } from "node:crypto";
export class OsaAdapterError extends Error {
  constructor(code, message) { super(message); this.name = "OsaAdapterError"; this.code = code; }
}
const required = (x, name) => { if (typeof x !== "string" || !x.trim()) throw new OsaAdapterError("INVALID_INPUT", name + " required"); return x; };
const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
export function createMastraOsaTool({ apiBaseUrl, token, fetchImpl = fetch, missionFactory, verifyReceipt }) {
  let url;
  try { url = new URL(apiBaseUrl); } catch { throw new OsaAdapterError("CONFIG", "valid HTTPS URL required"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new OsaAdapterError("CONFIG", "HTTPS OSA API URL required");
  if (!token) throw new OsaAdapterError("CONFIG", "authenticated OSA API token required");
  if (typeof missionFactory !== "function") throw new OsaAdapterError("CONFIG", "missionFactory required");
  if (typeof verifyReceipt !== "function") throw new OsaAdapterError("CONFIG", "independent verifyReceipt callback required");
  const base = url.href.replace(/\/$/, "");
  const request = async (method, path, body) => {
    let response;
    try {
      response = await fetchImpl(base + path, { method, headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new OsaAdapterError("OSA_UNAVAILABLE", "OSA request failed; execution state UNKNOWN; no automatic retry"); }
    if (!response.ok) throw new OsaAdapterError(response.status === 409 ? "DUPLICATE_MISSION" : "OSA_REJECTED", "OSA HTTP " + response.status + "; no automatic retry");
    try { return await response.json(); } catch { throw new OsaAdapterError("INVALID_RESPONSE", "OSA returned invalid JSON"); }
  };
  return async function execute({ mastraRunId, toolCallId, toolName, input }) {
    required(mastraRunId, "mastraRunId"); required(toolCallId, "toolCallId"); required(toolName, "toolName");
    if (input === undefined) throw new OsaAdapterError("INVALID_INPUT", "input required");
    const mission = await missionFactory({ mastraRunId, toolCallId, toolName, input });
    if (!mission || typeof mission !== "object") throw new OsaAdapterError("INVALID_MISSION", "missionFactory returned no mission");
    const id = required(mission.mission_id, "mission_id");
    const org = required(mission.organization_id, "organization_id");
    const session = await request("GET", "/session");
    if (session?.identity?.organization_id !== org) throw new OsaAdapterError("TENANT_SCOPE_DENIED", "OSA session tenant does not match mission");
    const created = await request("POST", "/missions", mission);
    if (created.mission_id !== id) throw new OsaAdapterError("BINDING_MISMATCH", "mission creation ID mismatch");
    const run = await request("POST", "/missions/" + encodeURIComponent(id) + "/run");
    if (!run.run_id || !run.execution_id || run.verdict !== "VERIFIED" || run.proof?.run_id !== run.run_id || run.proof?.execution_id !== run.execution_id || run.proof?.mission_id !== id || run.proof?.verdict !== "VERIFIED") throw new OsaAdapterError("RUN_NOT_VERIFIED", "run/proof missing, mismatched or not verified");
    const receipt = await request("GET", "/missions/" + encodeURIComponent(id) + "/receipt");
    if (receipt.schema !== "osa.mission_receipt.v1" || receipt.mission_id !== id || !receipt.receipt_sha256 || receipt.verification_receipt_sha256 !== run.proof.receipt_sha256) throw new OsaAdapterError("RECEIPT_MISMATCH", "mission receipt and proof binding mismatch");
    const record = await request("GET", "/missions/" + encodeURIComponent(id));
    if (record?.mission?.mission_id !== id || record?.run?.run_id !== run.run_id || record?.run?.execution_id !== run.execution_id || record?.mission_receipt?.receipt_sha256 !== receipt.receipt_sha256) throw new OsaAdapterError("RECORD_MISMATCH", "persisted mission record mismatch");
    let independentlyVerified = false;
    try { independentlyVerified = await verifyReceipt({ mission, run, receipt, record }); }
    catch { throw new OsaAdapterError("VERIFIER_FAILED", "independent verification failed"); }
    if (independentlyVerified !== true) throw new OsaAdapterError("VERIFIER_FAILED", "independent verification did not approve");
    return { schema: "osa.mastra.binding.v1", mastra_run_id: mastraRunId, mastra_tool_call_id: toolCallId, tool_name: toolName, input_sha256: hash(input), osa_mission_id: id, osa_run_id: run.run_id, osa_execution_id: run.execution_id, osa_verdict: run.verdict, mission_receipt_sha256: receipt.receipt_sha256, verification: "VERIFIER_CALLBACK_APPROVED", output: run.final_output };
  };
}
