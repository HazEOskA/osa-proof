import { createHash } from "node:crypto";

// Deterministic JSON for content addressing (subset of RFC 8785 JCS):
// object keys sorted, undefined object members omitted, undefined array items -> null,
// Date -> ISO string. Non-finite numbers, bigint, functions, symbols and
// non-plain objects are rejected so two different values never share a digest.
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError(`non-finite number at ${path}`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalizationError(`unsupported ${typeof value} at ${path}`);
  }

  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => (item === undefined ? "null" : encode(item, `${path}[${index}]`))).join(",")}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalizationError(`unsupported object at ${path}`);
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key], `${path}.${key}`)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function digest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

// Digest of an object excluding its own digest field.
export function digestWithout<T extends object>(value: T, field: keyof T): string {
  const { [field]: _omitted, ...rest } = value;
  return digest(rest);
}
