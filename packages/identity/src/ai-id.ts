import { domainToASCII } from "node:url";

export interface ParsedAiId {
  authority: string;
  profile_path: string[];
  canonical: string;
}

function invalid(message: string): never {
  throw new Error(`AI_ID_INVALID: ${message}`);
}

export function parseAiId(input: string): ParsedAiId {
  const value = String(input ?? "").trim();
  if (!/^@ai:/i.test(value)) invalid("identifier must start with @ai:");

  const body = value.slice(4);
  if (!body) invalid("authority is required");
  if (/[?#%]/.test(body)) invalid("query, fragment and percent-encoding are forbidden");

  const slash = body.indexOf("/");
  let authority = slash >= 0 ? body.slice(0, slash) : body;
  const rawPath = slash >= 0 ? body.slice(slash + 1) : "";

  if (!authority) invalid("authority is required");
  if (authority.includes("@")) invalid("userinfo is forbidden");
  if (authority.includes(":")) invalid("ports are forbidden");

  authority = authority.replace(/\.$/, "").toLowerCase();
  const ascii = domainToASCII(authority);
  if (!ascii) invalid("authority is not a valid DNS name");

  const labels = ascii.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    )
  ) {
    invalid("authority is not a valid DNS domain");
  }

  const profilePath =
    rawPath === ""
      ? []
      : rawPath.split("/").map((segment) => {
          if (!segment) invalid("empty path segments are forbidden");
          if (segment === "." || segment === "..") invalid("dot segments are forbidden");
          if (!/^[A-Za-z0-9._-]+$/.test(segment)) invalid("path segment contains unsupported characters");
          return segment;
        });

  const canonical = `@ai:${ascii}${profilePath.length ? `/${profilePath.join("/")}` : ""}`;
  return { authority: ascii, profile_path: profilePath, canonical };
}

export function canonicalizeAiId(input: string): string {
  return parseAiId(input).canonical;
}

export function aiProfileUrl(input: string): string {
  const parsed = parseAiId(input);
  return `https://${parsed.authority}/.well-known/ai-profile.json`;
}
