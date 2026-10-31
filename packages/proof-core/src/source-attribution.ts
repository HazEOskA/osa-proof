import type { ClaimAttribution, ClaimAttributionMode, Mission, ToolCallRecord } from "../../contracts/src";
import { digest, digestWithout } from "./canonical";

/**
 * Attribution Gate v1 handles external API operations and numeric facts.
 * It is a deterministic subset, NOT complete natural-language understanding.
 * Unsupported factual claims in external-source missions fail closed.
 */
const apiOperation = /(?:zintegrował\w*|połączył\w*|zaimplementował\w*|integrat\w*|integrated|implemented)[^.!?\n]*\bapi\b|\bapi\b[^.!?\n]*(?:zintegrował\w*|połączył\w*|integrat\w*|integrated)/i;
const numeric = /(-?\d+(?:[.,]\d+)?)/g;

function reportText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return "";
  const record = output as Record<string, unknown>;
  const artifact = record.artifact && typeof record.artifact === "object"
    ? record.artifact as Record<string, unknown> : {};
  return [record.report, record.answer, record.message, record.text, record.content, artifact.content]
    .filter((v): v is string => typeof v === "string").join("\n");
}

export function verifyRuntimeToolCall(record: ToolCallRecord): boolean {
  if (!record || !record.tool_ref || !record.tool_call_id || !record.operation_id || !record.agent_id) return false;
  try {
    return record.request_sha256.length === 64 &&
      record.response_sha256 === digest(record.response) &&
      record.record_sha256 === digestWithout(record, "record_sha256");
  } catch { return false; }
}

function sourcedTemperatures(response: unknown): number[] {
  const values: number[] = [];
  const visit = (value: unknown, key: string, depth: number): void => {
    if (depth > 12) return;
    if (/^(?:temperature|temp|temperature_celsius|temp_celsius|celsius)$/i.test(key)) {
      if (typeof value === "number" && Number.isFinite(value)) values.push(value);
    }
    if (Array.isArray(value)) value.forEach(v => visit(v, key, depth + 1));
    else if (value && typeof value === "object") for (const [name, v] of Object.entries(value)) visit(v, name, depth + 1);
  };
  visit(response, "", 0);
  return values;
}

export function attributeExternalClaims(
  mission: Mission, output: unknown, calls: ToolCallRecord[], mode: ClaimAttributionMode = "DEFAULT_ON"
): { active: boolean; claims: ClaimAttribution[]; failure_code?: "CLAIM_UNSUPPORTED" | "CLAIM_VALUE_MISMATCH" | "CLAIM_COVERAGE_INCOMPLETE" } {
  const report = reportText(output);
  const operation = apiOperation.exec(report);
  // Default-on. Mission text, input and executor evidence cannot disable the gate.
  const active = mode !== "CONTROL_PLANE_NO_EXTERNAL_FACTS";
  if (!active) return {active: false, claims: []};

  const claims: ClaimAttribution[] = [];
  const accepted = calls.filter(verifyRuntimeToolCall);
  const add = (claim: string, kind: ClaimAttribution["kind"], reason: ClaimAttribution["reason_code"], value?: number, call?: ToolCallRecord) => {
    claims.push({
      claim, claim_sha256: digest(claim), kind, ...(value === undefined ? {} : {value}),
      status: reason ? "UNSUPPORTED" : "SUPPORTED",
      ...(reason ? {reason_code: reason} : {}),
      ...(call ? {tool_call_id: call.tool_call_id, response_sha256: call.response_sha256} : {}),
    });
  };
  if (operation) {
    // A successful API request alone does not prove an implemented integration.
    // Until runtime can attest both implementation and its tests, fail closed.
    add(operation[0], "api_operation", "CLAIM_UNSUPPORTED");
  }

  const measurements = [...report.matchAll(/-?\d+(?:[.,]\d+)?\s*°\s*C\b/gi)]
    .map(match => ({text: match[0], value: Number(match[0].match(numeric)?.[0].replace(",", "."))}));
  const out: Record<string,unknown> = output && typeof output === "object" ? output as Record<string,unknown> : {};
  if (typeof out.temperature_celsius === "number" && Number.isFinite(out.temperature_celsius) &&
      !measurements.some(x => x.value === out.temperature_celsius)) {
    measurements.push({text: "temperature_celsius=" + out.temperature_celsius, value: out.temperature_celsius});
  }
  for (const measurement of measurements) {
    const responses = accepted.flatMap(call => sourcedTemperatures(call.response).map(value => ({call,value})));
    const source = responses.find(item => Object.is(item.value, measurement.value));
    const reason = source ? undefined : responses.length > 0 ? "CLAIM_VALUE_MISMATCH" : "CLAIM_UNSUPPORTED";
    add(measurement.text, "temperature", reason, measurement.value, source?.call);
  }

  // Every other number in an externally sourced report also needs an independently
  // matched numeric response; do not require sources for unrelated creative tasks.
  const reportWithoutTemperatures = report.replace(/-?\d+(?:[.,]\d+)?\s*°\s*C\b/gi, "");
  for (const match of reportWithoutTemperatures.matchAll(numeric)) {
    const value = Number(match[0].replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const matched = accepted.find(call => sourcedTemperatures(call.response).some(v => Object.is(v, value)));
    // Arbitrary numeric facts do not inherit a temperature value or unrelated
    // tool response. Without a trusted source: exact CLAIM_UNSUPPORTED.
    // With a tool response but no recognized field/unit mapping: incomplete.
    const reason = accepted.length === 0 ? "CLAIM_UNSUPPORTED" : "CLAIM_COVERAGE_INCOMPLETE";
    add(match[0], "external_number", reason, value, matched);
  }

  // Each sentence in an external-data report must have at least one covered
  // numeric value or an explicitly checked operation. Unsupported prose
  // cannot silently inherit the source of an unrelated number.
  // The default-on gate is active for every run, but should not invent
  // factual claims from unrelated prose without detectable source assertions.
  // Unknown prose alongside an explicit numeric/API claim still fails closed.
  const hasDetectableExternalClaim = Boolean(operation) || /\d/.test(report) ||
    /temperatur|pogod|weather|\b(?:api|kurs|exchange\s+rate|bitcoin|btc)\b/i.test(mission.objective + " " + report);
  for (const sentence of (hasDetectableExternalClaim ? report.split(/[.!?\n]+/) : []).map(s=>s.trim()).filter(Boolean)) {
    if (apiOperation.test(sentence)) continue;
    // Do not consider an unrelated assertion sourced merely because the same
    // sentence also contains a proven temperature value. Supported grammar v1
    // is intentionally small; unrecognized factual prose is NOT VERIFIED.
    const template = sentence.replace(/-?\d+(?:[.,]\d+)?\s*°\s*C\b/gi, "{TEMP}");
    const plainTemperature = /^(?:aktualna\s+)?temperatura\s+(?:wynosi|jest|to)\s+\{TEMP\}$/i.test(template) ||
      /^\{TEMP\}$/.test(template);
    if (!plainTemperature) add(sentence, "unclassified", "CLAIM_COVERAGE_INCOMPLETE");
  }

  // Empty or nonfactual output contains no source claims to assert. The gate
  // remains enabled, and newly introduced numeric claims are still checked.

  const failures = claims.filter(claim => claim.status === "UNSUPPORTED");
  const failure_code = failures.some(claim => claim.reason_code === "CLAIM_VALUE_MISMATCH") ? "CLAIM_VALUE_MISMATCH"
    : failures.some(claim => claim.reason_code === "CLAIM_UNSUPPORTED") ? "CLAIM_UNSUPPORTED"
    : failures.length ? "CLAIM_COVERAGE_INCOMPLETE" : undefined;
  return {active, claims, ...(failure_code ? {failure_code} : {})};
}
