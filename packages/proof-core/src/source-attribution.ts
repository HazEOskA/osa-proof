import type { ClaimAttribution, ClaimAttributionMode, Mission, ToolCallRecord } from "../../contracts/src";
import { digest, digestWithout } from "./canonical";

// Deterministic, intentionally limited grammar. Never execute generated code.
const apiOperation = /(?:zintegrował\w*|połączył\w*|zaimplementował\w*|integrat\w*|integrated|implemented)[^.!?\n]*\bapi\b|\bapi\b[^.!?\n]*(?:zintegrował\w*|połączył\w*|integrat\w*|integrated)/i;
const tempValue = /-?\d+(?:[.,]\d+)?\s*°\s*C\b/gi;
const weatherFact = /(?:aktualn\w*|obecn\w*|teraz|dzisiaj|current|live|today)[^.!?\n]{0,100}(?:temperatur\w*|pogod\w*|weather)|(?:temperatur\w*|pogod\w*|weather)[^.!?\n]{0,100}(?:aktualn\w*|obecn\w*|current|live|teraz|today)/i;
const marketFact = /(?:kurs|cena|price|exchange rate|value of)[^.!?\n]{0,80}(?:bitcoin|bitcoina|btc|usd|eur|\$|€)|(?:bitcoin|bitcoina|btc)[^.!?\n]{0,80}(?:kurs|cena|price|wynosi|is|usd|eur|\$|€)/i;
const moneyValue = /-?\d+(?:[.,]\d+)?\s*(?:USD|EUR|PLN)\b|[$€]\s*-?\d+(?:[.,]\d+)?/gi;
const numberOnly = /-?\d+(?:[.,]\d+)?/;
const sample = /^(?:przykład|przykładow|dane\s+(?:fikcyjne|testowe|demo)|symulacj|mock|sample|example|fictional|placeholder|demo\b|test\s+data)/i;

function reportSurfaces(output: unknown): string[] {
  if (typeof output === "string") return [output];
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const o = output as Record<string,unknown>;
  const artifact = o.artifact && typeof o.artifact === "object" && !Array.isArray(o.artifact)
    ? o.artifact as Record<string,unknown> : {};
  // A native cryptographic tool's "text" is raw user input, not a claim.
  const isRawTool = typeof o.tool === "string";
  const fields = [o.report, o.answer, o.message, o.content, artifact.content, ...(isRawTool ? [] : [o.text])];
  const fileContents: string[] = [];
  const scanFileCollection = (value: unknown, depth: number): void => {
    if (depth > 5) return;
    if (Array.isArray(value)) { for (const entry of value) scanFileCollection(entry, depth+1); return; }
    if (!value || typeof value !== "object") return;
    const file = value as Record<string,unknown>;
    const path = typeof file.path === "string" ? file.path : typeof file.name === "string" ? file.name : "";
    const mime = typeof file.media_type === "string" ? file.media_type : "";
    if (/\.(?:html?|[cm]?[jt]sx?)$/i.test(path) || /(?:html|javascript|typescript)/i.test(mime)) {
      for (const key of ["content","source","code"]) {
        if (typeof file[key] === "string") fileContents.push(file[key] as string);
      }
    }
    scanFileCollection(file.files,depth+1);
    scanFileCollection(file.artifacts,depth+1);
  };
  scanFileCollection(o.files,0);
  scanFileCollection(o.artifacts,0);
  scanFileCollection(artifact.files,0);
  return [...fields, ...fileContents].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
function textFromHtml(raw: string): string {
  const noStyles = raw.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const visible = noStyles.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/gi, " ");
  const scripts = [...noStyles.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  return [visible, ...scripts].join("\n");
}
function segments(output: unknown): string[] {
  return reportSurfaces(output).flatMap(text =>
    (/<\s*(?:!doctype|html|body|script|main)\b/i.test(text) ? textFromHtml(text) : text)
      .split(/[\n;!?]+|(?<!\d)\.(?!\d)(?=\s|$)/g).map(s => s.trim()).filter(Boolean));
}
function value(text: string): number | undefined {
  const match = numberOnly.exec(text);
  if (!match) return undefined;
  const n = Number(match[0].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}
export function verifyRuntimeToolCall(record: ToolCallRecord): boolean {
  if (!record || !record.tool_ref || !record.tool_call_id || !record.operation_id || !record.agent_id) return false;
  try {
    return record.request_sha256.length === 64 &&
      record.response_sha256 === digest(record.response) &&
      record.record_sha256 === digestWithout(record, "record_sha256");
  } catch { return false; }
}
function sourcedValues(response: unknown, fields: RegExp): number[] {
  const values: number[] = [];
  const visit = (v:unknown,key:string,depth:number):void => {
    if (depth>12) return;
    if (fields.test(key) && typeof v==="number" && Number.isFinite(v)) values.push(v);
    if (Array.isArray(v)) v.forEach(x => visit(x,key,depth+1));
    else if (v && typeof v==="object") for (const [name,x] of Object.entries(v)) visit(x,name,depth+1);
  };
  visit(response,"",0);
  return values;
}
export function attributeExternalClaims(
  mission: Mission, output: unknown, calls: ToolCallRecord[], mode: ClaimAttributionMode = "DEFAULT_ON"
): {active:boolean;claims:ClaimAttribution[];failure_code?:"CLAIM_UNSUPPORTED"|"CLAIM_VALUE_MISMATCH"|"CLAIM_COVERAGE_INCOMPLETE"} {
  // The argument is set by runtime, never from mission input or executor evidence.
  void mission;
  if (mode==="CONTROL_PLANE_NO_EXTERNAL_FACTS") return {active:false,claims:[]};
  const claims:ClaimAttribution[] = [];
  const trusted = calls.filter(verifyRuntimeToolCall);
  const tempFields=/^(?:temperature|temp|temperature_celsius|temp_celsius|celsius)$/i;
  const priceFields=/^(?:price|price_usd|price_eur|rate|rate_usd|bitcoin_usd|btc_usd|value_usd)$/i;
  const add=(claim:string,kind:ClaimAttribution["kind"],code:ClaimAttribution["reason_code"],n?:number,call?:ToolCallRecord):void=>{
    claims.push({claim,claim_sha256:digest(claim),kind,...(n===undefined?{}:{value:n}),
      status:code?"UNSUPPORTED":"SUPPORTED",...(code?{reason_code:code}:{}),
      ...(call?{tool_call_id:call.tool_call_id,response_sha256:call.response_sha256}:{})});
  };
  const check=(kind:"temperature"|"external_number",claim:string,n:number):void=>{
    const matches=trusted.flatMap(call=>sourcedValues(call.response,kind==="temperature"?tempFields:priceFields).map(found=>({call,found})));
    const source=matches.find(x=>Object.is(x.found,n));
    const reason=source?undefined:matches.length?"CLAIM_VALUE_MISMATCH":"CLAIM_UNSUPPORTED";
    add(claim,kind,reason,n,source?.call);
  };
  for (const segment of segments(output)) {
    const operation=apiOperation.exec(segment);
    if (operation) add(operation[0],"api_operation","CLAIM_UNSUPPORTED");
    if (sample.test(segment)) continue; // Labelled example is not an asserted live fact.
    const temps=[...segment.matchAll(tempValue)];
    for (const match of temps) {const n=value(match[0]);if(n!==undefined)check("temperature",match[0],n);}
    // Literal facts inside HTML/JS, without a Celsius glyph.
    const sourceCodeTemp=/(?:currentWeather|liveWeather|aktualnaTemperatura|currentTemperature|liveTemperature)[^;\n]{0,140}?(?:temperature_celsius|temperature|temp|celsius)\s*[:=]\s*(-?\d+(?:[.,]\d+)?)/gi;
    for (const m of segment.matchAll(sourceCodeTemp)) {
      const n=Number(m[1].replace(",","."));
      if (!temps.some(t=>value(t[0])===n)) check("temperature",m[0],n);
    }
    if (!temps.length && weatherFact.test(segment)) {
      const match=/(?:temperatur\w*|pogod\w*|weather)[^;\n]{0,100}?(-?\d+(?:[.,]\d+)?)(?:\s*(?:C|stopni|degrees))?\b/i.exec(segment);
      const n=match?Number(match[1].replace(",",".")):undefined;
      if (n!==undefined&&Number.isFinite(n)) check("temperature",match![0],n);
    }
    if (marketFact.test(segment)) {
      const money=[...segment.matchAll(moneyValue)];
      const m=money[0]??/(?:wynosi|is|equals|:)\s*(-?\d+(?:[.,]\d+)?)/i.exec(segment);
      if(m){const n=value(m[0]);if(n!==undefined)check("external_number",String(n),n);}
      else add(segment,"unclassified","CLAIM_COVERAGE_INCOMPLETE");
    }
  }
  const o=output&&typeof output==="object"&&!Array.isArray(output)?output as Record<string,unknown>:{};
  if(typeof o.temperature_celsius==="number"&&Number.isFinite(o.temperature_celsius)&&
    !claims.some(c=>c.kind==="temperature"&&c.value===o.temperature_celsius)) {
    check("temperature","temperature_celsius="+o.temperature_celsius,o.temperature_celsius);
  }
  const failure_code=claims.some(c=>c.reason_code==="CLAIM_VALUE_MISMATCH")?"CLAIM_VALUE_MISMATCH":
    claims.some(c=>c.reason_code==="CLAIM_UNSUPPORTED")?"CLAIM_UNSUPPORTED":
    claims.some(c=>c.reason_code==="CLAIM_COVERAGE_INCOMPLETE")?"CLAIM_COVERAGE_INCOMPLETE":undefined;
  return {active:true,claims,...(failure_code?{failure_code}:{})};
}
