import type { IncomingMessage } from "node:http";
import type { SessionRecord } from "../../../packages/contracts/src";

// Vercel Deployment Protection enforces entry before this code runs.
// IMPORTANT: Shareable Links and automation bypass can also grant entry; treat
// possession of the protected alias access as a full operator capability.
// This identity is an operator of the protected Preview, not a GitHub user.
export class PreviewOperator {
  readonly session: SessionRecord;
  private constructor(organization: string, project: string) {
    this.session = {
      session_id: "ses_vercel_protected_preview", token: "",
      identity: { identity_id: "idn_vercel_protected_preview", provider: "vercel-preview",
        subject: "vercel-protected-preview", display_name: "Operator Preview",
        organization_id: organization, project_ids: [project], roles: ["operator"], verified: true },
      created_at: "1970-01-01T00:00:00.000Z", expires_at: "9999-12-31T23:59:59.999Z",
    };
  }
  static fromEnvironment(env: Record<string, string | undefined>): PreviewOperator | undefined {
    if (env.OSA_PREVIEW_SINGLE_OPERATOR === undefined) return undefined;
    if (env.OSA_PREVIEW_SINGLE_OPERATOR !== "enabled" || env.VERCEL !== "1" ||
        env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "codex/neurosa-chat-memory" ||
        (env.VERCEL_GIT_REPO_OWNER !== undefined && env.VERCEL_GIT_REPO_OWNER !== "HazEOskA") ||
        (env.VERCEL_GIT_REPO_SLUG !== undefined && env.VERCEL_GIT_REPO_SLUG !== "osa-proof"))
      throw new Error("Single operator is limited to the protected approved Vercel Preview branch.");
    const organization = env.OSA_NEUROSA_ORGANIZATION_ID;
    const project = env.OSA_NEUROSA_PROJECT_ID;
    if (!organization || !project || !/^[A-Za-z0-9_.:-]{1,200}$/.test(organization) ||
        !/^[A-Za-z0-9_.:-]{1,200}$/.test(project))
      throw new Error("Single operator requires a fixed server-side NeurOSA organization/project binding.");
    return new PreviewOperator(organization, project);
  }
  sameOriginMutation(request: IncomingMessage): boolean {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET")) return true;
    try {
      const origin = new URL(String(request.headers.origin ?? ""));
      const host = request.headers.host;
      return origin.protocol === "https:" && Boolean(host) &&
        origin.host.toLowerCase() === host!.toLowerCase() &&
        (!request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin");
    } catch { return false; }
  }
}
