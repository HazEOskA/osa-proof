/**
 * Wąska deterministyczna bramka rachunkowa dla porównywalnych danych e-commerce.
 * Nie ocenia rentowności całego przedsiębiorstwa ani jakości decyzji biznesowej.
 * Nie korzysta z LLM, nie ma narzędzi i nie wykonuje operacji finansowych.
 */
export type CommerceGateVerdict =
  | { state: "NOT_APPLICABLE" }
  | { state: "PASS"; netPln: string }
  | { state: "BLOCKED"; code: "COMMERCE_INPUT_INCOMPLETE" | "COMMERCE_MODEL_RESULT_MISMATCH" | "COMMERCE_MODEL_RESULT_MISSING"; netPln?: string };

type Field = "revenue" | "ads" | "goods" | "shipping" | "fees";
const labels: Record<Field, RegExp> = {
  revenue: /przych[oó]d netto[^:\n]{0,60}:\s*/i,
  ads: /koszt reklam\s*:\s*/i,
  goods: /koszt sprzedanych produkt[oó]w\s*:\s*/i,
  shipping: /logistyka\s*:\s*/i,
  fees: /op[lł]aty transakcyjne\s*:\s*/i,
};
const fields: Field[] = ["revenue", "ads", "goods", "shipping", "fees"];
const amount = /^([+-]?\d+(?:[ \u00a0\u202f]\d{3})*(?:,\d{1,2})?)(?=\s*(?:zł|PLN)?(?:\s|$|[.,;!?)]))/i;

function toCents(value: string): number | null {
  const normalized = value.replace(/[ \u00a0\u202f]/g, "");
  const matched = /^([+-]?\d+)(?:,(\d{1,2}))?$/.exec(normalized);
  if (!matched) return null;
  const cents = Number(matched[1]) * 100 + (matched[1].startsWith("-") ? -1 : 1) * Number((matched[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

function readMoney(prompt: string, field: Field): number | null {
  const found: number[] = [];
  for (const line of prompt.split(/\r?\n/)) {
    const key = labels[field].exec(line);
    if (!key) continue;
    const match = amount.exec(line.slice(key.index + key[0].length));
    if (!match) return null;
    const parsed = toCents(match[1]);
    if (parsed === null) return null;
    found.push(parsed);
  }
  // Duplicate values are ambiguous even if equal (different periods/contexts).
  return found.length === 1 ? found[0] : null;
}

function outputValues(reply: string): number[] {
  const result: number[] = [];
  const lines = reply.replace(/[`*_]/g, "").split(/\r?\n|[.;](?=\s|$)|,(?=\s*(?:ale\s+)?(?:wynik|zysk|strata))/i);
  for (const line of lines) {
    // This label describes a final or operating result, not a subtotal of COGS.
    if (!/(?:wynik (?:finansowy|netto|operacyjny|kampanii)|zysk(?: netto| operacyjny)?|strata|bottom.line)/i.test(line)) continue;
    if (/przed (?:kosztami?|uwzgl[eę]dnieniem) reklam/i.test(line)) continue;
    const matches = [...line.matchAll(/(minus\s*|[-−]\s*)?((?:\d+(?:[ \u00a0\u202f]\d{3})*)(?:,\d{1,2})?)\s*(?:zł|PLN)(?=\s|$|[.,;!?)])/gi)];
    // On an equation line, the final currency figure is the stated result.
    if (matches.length) {
      const m = matches[matches.length - 1];
      const signed = /minus|[-−]/i.test(m[1] ?? "") ? "-" + m[2] : m[2];
      const cents = toCents(signed);
      if (cents !== null) result.push(cents);
    }
  }
  return result;
}

function displayPln(cents: number): string {
  const prefix = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  return prefix + whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (absolute % 100 ? "," + String(absolute % 100).padStart(2, "0") : "");
}

/** Guard applies only to a bounded, explicitly labeled five-field campaign case. */
export function checkCommerceArithmetic(prompt: string, reply: string): CommerceGateVerdict {
  const cues = fields.filter(f => labels[f].test(prompt)).length;
  if (cues < 3 || !/(?:ROAS|kampani|budżet|e-commerce|sklep)/i.test(prompt)) return { state: "NOT_APPLICABLE" };
  const amounts = fields.map(f => readMoney(prompt, f));
  if (amounts.some(n => n === null)) return { state: "BLOCKED", code: "COMMERCE_INPUT_INCOMPLETE" };
  const [revenue, ads, goods, shipping, fees] = amounts as number[];
  if ([revenue, ads, goods, shipping, fees].some(v => v < 0) || [revenue, ads, goods, shipping, fees].some(v => !Number.isSafeInteger(v)))
    return { state: "BLOCKED", code: "COMMERCE_INPUT_INCOMPLETE" };
  const net = revenue - ads - goods - shipping - fees;
  if (!Number.isSafeInteger(net)) return { state: "BLOCKED", code: "COMMERCE_INPUT_INCOMPLETE" };
  const netPln = displayPln(net);
  const observed = outputValues(reply);
  if (!observed.length) return { state: "BLOCKED", code: "COMMERCE_MODEL_RESULT_MISSING", netPln };
  if (!observed.every(value => value === net)) return { state: "BLOCKED", code: "COMMERCE_MODEL_RESULT_MISMATCH", netPln };
  return { state: "PASS", netPln };
}
