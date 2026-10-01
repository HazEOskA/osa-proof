import { Web3Scope } from "../../contracts/src";
export class Web3Error extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); this.name = "Web3Error"; }
}
export function assertScope(scope: Web3Scope): void {
  if (!scope || [scope.organization_id, scope.project_id, scope.mission_id].some(v => typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(v))) throw new Web3Error("WEB3_SCOPE_INVALID");
}
export function sameScope(a: Web3Scope, b: Web3Scope): boolean {
  return a.organization_id === b.organization_id && a.project_id === b.project_id && a.mission_id === b.mission_id;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Web3Error("WEB3_OBJECT_INVALID");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Web3Error("WEB3_STRING_INVALID");
  return value;
}
export function timestamp(value: unknown): string {
  const s = text(value, 40);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s) throw new Web3Error("WEB3_TIMESTAMP_INVALID");
  return s;
}
export function chain(value: unknown) {
  const c = object(value); return { id: text(c.id, 64), network: text(c.network, 128) };
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Web3Error("WEB3_LIST_INVALID");
  return [...new Set(value.map(v => text(v)))].sort();
}
// Public metadata is deliberately bounded and never accepts key/seed material.
export function safeMetadata(value: unknown): Record<string, unknown> {
  const v = object(value);
  const visit = (x: unknown, depth: number): void => {
    if (depth > 12) throw new Web3Error("WEB3_METADATA_TOO_DEEP");
    if (typeof x === "number" && !Number.isFinite(x)) throw new Web3Error("WEB3_METADATA_INVALID");
    if (x !== null && typeof x === "object") for (const [k, child] of Object.entries(x)) {
      if (/private.?key|seed.?phrase|mnemonic|secret|password|authorization/i.test(k)) throw new Web3Error("WEB3_SECRET_FIELD_FORBIDDEN");
      visit(child, depth + 1);
    }
    else if (!["string", "number", "boolean"].includes(typeof x) && x !== null) throw new Web3Error("WEB3_METADATA_INVALID");
  };
  visit(v, 0);
  if (JSON.stringify(v).length > 65536) throw new Web3Error("WEB3_METADATA_TOO_LARGE");
  return structuredClone(v);
}
