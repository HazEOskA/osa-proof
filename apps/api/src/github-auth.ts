import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionRecord } from "../../../packages/contracts/src";

const SESSION_COOKIE = "__Host-osa_session";
const FLOW_COOKIE = "__Host-osa_oauth";
const SESSION_SECONDS = 3600;
const FLOW_SECONDS = 600;
type Env = Record<string, string | undefined>;
interface Config { clientId: string; clientSecret: string; key: Buffer; origin: string; members: Set<string>; organization: string; project: string }
interface Ticket { issued: number; expires: number; [key: string]: unknown }

export class GithubAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function denied(): never { throw new GithubAuthError(401, "GITHUB_AUTH_REJECTED", "Nie udało się potwierdzić logowania GitHub. Rozpocznij logowanie ponownie."); }
function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const matches = (request.headers.cookie ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}
function cookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
function equal(a: string, b: string): boolean {
  return Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class GithubAuth {
  private constructor(private readonly config: Config, private readonly fetcher: typeof fetch, private readonly now: () => number) {}
  static fromEnvironment(env: Env, fetcher: typeof fetch = fetch, now = Date.now): GithubAuth | undefined {
    const names = ["OSA_GITHUB_CLIENT_ID", "OSA_GITHUB_CLIENT_SECRET", "OSA_SESSION_KEY", "OSA_PUBLIC_ORIGIN", "OSA_GITHUB_ALLOWED_USER_IDS"];
    if (!names.some(name => env[name] !== undefined)) return undefined;
    if (names.some(name => !env[name]?.trim()) || !env.OSA_NEUROSA_ORGANIZATION_ID?.trim() || !env.OSA_NEUROSA_PROJECT_ID?.trim())
      throw new Error("GitHub wymaga pełnej konfiguracji OAuth, klucza sesji i jawnego zakresu organizacja/projekt.");
    let origin: URL;
    try { origin = new URL(env.OSA_PUBLIC_ORIGIN!); } catch { throw new Error("OSA_PUBLIC_ORIGIN musi być originem HTTPS."); }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/")
      throw new Error("OSA_PUBLIC_ORIGIN musi być originem HTTPS bez ścieżki i danych logowania.");
    if (!/^[a-fA-F0-9]{64}$/.test(env.OSA_SESSION_KEY!)) throw new Error("OSA_SESSION_KEY wymaga 32 losowych bajtów zakodowanych jako 64 znaki hex.");
    if (!/^[A-Za-z0-9_.-]{8,200}$/.test(env.OSA_GITHUB_CLIENT_ID!) || !/^[\x21-\x7e]{16,4096}$/.test(env.OSA_GITHUB_CLIENT_SECRET!))
      throw new Error("Nieprawidłowy format konfiguracji aplikacji GitHub OAuth.");
    const members = env.OSA_GITHUB_ALLOWED_USER_IDS!.split(",").map(v => v.trim());
    if (members.length > 1000 || members.some(v => !/^[1-9][0-9]{0,15}$/.test(v) || !Number.isSafeInteger(Number(v))))
      throw new Error("OSA_GITHUB_ALLOWED_USER_IDS wymaga listy numerycznych identyfikatorów kont GitHub.");
    for (const key of ["OSA_NEUROSA_ORGANIZATION_ID", "OSA_NEUROSA_PROJECT_ID"])
      if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(env[key]!)) throw new Error("Nieprawidłowy zakres dostępu GitHub.");
    return new GithubAuth({ clientId: env.OSA_GITHUB_CLIENT_ID!, clientSecret: env.OSA_GITHUB_CLIENT_SECRET!, key: Buffer.from(env.OSA_SESSION_KEY!, "hex"),
      origin: origin.origin, members: new Set(members), organization: env.OSA_NEUROSA_ORGANIZATION_ID!, project: env.OSA_NEUROSA_PROJECT_ID! }, fetcher, now);
  }
  private aad(purpose: string): Buffer { return Buffer.from(`osa.github.v1:${purpose}:${this.config.origin}:${this.config.clientId}`); }
  private seal(purpose: string, payload: Record<string, unknown>, seconds: number): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.config.key, iv);
    cipher.setAAD(this.aad(purpose));
    const issued = Math.floor(this.now() / 1000);
    const data = Buffer.concat([cipher.update(JSON.stringify({ ...payload, issued, expires: issued + seconds })), cipher.final()]);
    return [iv, data, cipher.getAuthTag()].map(b => b.toString("base64url")).join(".");
  }
  private open(purpose: string, value: string | undefined, maxSeconds: number): Ticket | undefined {
    try {
      if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return;
      const [iv, data, tag] = value.split(".").map(v => Buffer.from(v, "base64url"));
      if (iv.length !== 12 || tag.length !== 16) return;
      const decipher = createDecipheriv("aes-256-gcm", this.config.key, iv);
      decipher.setAAD(this.aad(purpose)); decipher.setAuthTag(tag);
      const ticket = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as Ticket;
      const now = Math.floor(this.now() / 1000);
      if (!ticket || !Number.isSafeInteger(ticket.issued) || !Number.isSafeInteger(ticket.expires) ||
          ticket.issued > now + 30 || ticket.expires <= now || ticket.expires - ticket.issued !== maxSeconds) return;
      return ticket;
    } catch { return; }
  }
  hasSessionCookie(request: IncomingMessage): boolean {
    return (request.headers.cookie ?? "").split(";").some(v => v.trim().startsWith(SESSION_COOKIE + "="));
  }
  requireSameOrigin(request: IncomingMessage): void {
    if (request.headers.origin !== this.config.origin || (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin"))
      throw new GithubAuthError(403, "CSRF_ORIGIN_REJECTED", "Żądanie musi pochodzić z aplikacji OSA Proof.");
  }
  session(request: IncomingMessage): SessionRecord | undefined {
    const ticket = this.open("session", cookieValue(request, SESSION_COOKIE), SESSION_SECONDS);
    if (!ticket || typeof ticket.userId !== "string" || !this.config.members.has(ticket.userId) ||
        ticket.organization !== this.config.organization || ticket.project !== this.config.project ||
        typeof ticket.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(ticket.login) || typeof ticket.sessionId !== "string") return;
    return { session_id: ticket.sessionId, token: "", created_at: new Date(ticket.issued * 1000).toISOString(), expires_at: new Date(ticket.expires * 1000).toISOString(),
      identity: { identity_id: `github_${ticket.userId}`, provider: "github", subject: `github:${ticket.userId}`, display_name: ticket.login,
        verified: true, organization_id: this.config.organization, project_ids: [this.config.project], roles: ["member"] } };
  }
  start(response: ServerResponse): void {
    const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.callbackUrl(), scope: "read:user", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", allow_signup: "false" }).toString();
    response.writeHead(302, { location: url.toString(), "set-cookie": cookie(FLOW_COOKIE, this.seal("flow", { state, verifier }, FLOW_SECONDS), FLOW_SECONDS),
      "cache-control": "no-store", "referrer-policy": "no-referrer" });
    response.end();
  }
  private callbackUrl(): string { return this.config.origin + "/api/auth/github/callback"; }
  private async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("json")) return denied();
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break;
          size += part.value.length; if (size > 65536) { await reader.cancel(); return denied(); } chunks.push(part.value); }
      } finally { reader.releaseLock(); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) return denied();
      return data as Record<string, unknown>;
    } catch { return denied(); }
  }
  async callback(request: IncomingMessage, response: ServerResponse, params: URLSearchParams): Promise<void> {
    response.setHeader("set-cookie", cookie(FLOW_COOKIE, "", 0));
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    const ticket = this.open("flow", cookieValue(request, FLOW_COOKIE), FLOW_SECONDS);
    const state = params.get("state"), code = params.get("code");
    if (!ticket || typeof ticket.state !== "string" || typeof ticket.verifier !== "string" || !state || !code || code.length > 512 ||
        params.getAll("state").length !== 1 || params.getAll("code").length !== 1 || params.has("error") || !equal(state, ticket.state)) return denied();
    const token = await this.json("https://github.com/login/oauth/access_token", { method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code,
        redirect_uri: this.callbackUrl(), code_verifier: ticket.verifier }).toString() });
    if (typeof token.access_token !== "string" || !/^[A-Za-z0-9_.-]{10,4096}$/.test(token.access_token) ||
        typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer") return denied();
    const profile = await this.json("https://api.github.com/user", { headers: { accept: "application/vnd.github+json",
      authorization: `Bearer ${token.access_token}`, "x-github-api-version": "2022-11-28" } });
    if (!Number.isSafeInteger(profile.id) || (profile.id as number) <= 0 || typeof profile.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(profile.login)) return denied();
    if (!this.config.members.has(String(profile.id))) throw new GithubAuthError(403, "GITHUB_MEMBERSHIP_REQUIRED", "To konto GitHub nie ma przypisanego dostępu do projektu OSA Proof.");
    const value = this.seal("session", { userId: String(profile.id), login: profile.login, sessionId: `ses_github_${randomUUID()}`,
      organization: this.config.organization, project: this.config.project }, SESSION_SECONDS);
    response.writeHead(303, { location: this.config.origin + "/", "set-cookie": [cookie(FLOW_COOKIE, "", 0), cookie(SESSION_COOKIE, value, SESSION_SECONDS)] });
    response.end();
  }
  logout(request: IncomingMessage, response: ServerResponse): void {
    this.requireSameOrigin(request);
    response.setHeader("set-cookie", [cookie(SESSION_COOKIE, "", 0), cookie(FLOW_COOKIE, "", 0)]);
  }
}
