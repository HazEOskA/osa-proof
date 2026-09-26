import { createHash } from "node:crypto";
import type { Identity } from "../../contracts/src";

export interface LocalDevIdentityInput {
  display_name: string;
  email?: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function createLocalDevIdentity(input: LocalDevIdentityInput): Identity {
  const displayName = clean(input.display_name ?? "");
  if (!displayName) throw new Error("display_name is required");

  const email = clean(input.email ?? "").toLowerCase();
  if (email && !email.includes("@")) {
    throw new Error("email must be valid when provided");
  }

  const subjectSource = email || displayName.toLowerCase();
  const digest = createHash("sha256")
    .update(`local-dev:${subjectSource}`)
    .digest("hex")
    .slice(0, 20);

  return {
    identity_id: `idn_${digest}`,
    provider: "local-dev",
    subject: `local-dev:${subjectSource}`,
    display_name: displayName,
    ...(email ? { email } : {}),
    organization_id: "org_dev_local",
    roles: ["developer"],
    verified: true,
  };
}
