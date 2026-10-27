import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Identity, SessionRecord } from "../../../packages/contracts/src";

type Env = Record<string, string | undefined>;
type SocialProvider = "google" | "github";
const SESSION = "__Host-osa_social_session";
const PENDING = "__Host-osa_social_oauth";
const PENDING_MS = 10 * 60_000;
const SESSION_MS = 8 * 60 * 60_000;
const providers: SocialProvider[] = ["google", "github"];

function secureKey(env: Env): string {
  return env.OSA_PUBLIC_SESSION_SECRET ?? "";
}
function origin(env: Env): string {
  const raw = env.OSA_PUBLIC_AUTH_ORIGIN ?? "";
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
    parsed.pathname !== "/" || parsed.port) throw new Error("PUBLIC_AUTH_ORIGIN_INVALID");
  return parsed.origin;
}
function client(env: Env, provider: SocialProvider) {
  const prefix = provider === "google" ? "OSA_PUBLIC_GOOGLE_" : "OSA_PUBLIC_GITHUB_";
  return { id: env[prefix + "CLIENT_ID"] ?? "", secret: env[prefix + "CLIENT_SECRET"] ?? "" };
}
export function publicProviderStatus(env: Env = process.env) {
  const enabled = env.OSA_PUBLIC_AUTH_ENABLED === "enabled" && env.OSA_AUTH_MODE === "session" &&
    secureKey(env).length >= 32 && Boolean(env.OSA_PUBLIC_AUTH_ORIGIN);
  let validOrigin = false;
  if (enabled) { try { origin(env); validOrigin = true; } catch { /* deny */ } }
  return {
    google: enabled && validOrigin && Boolean(client(env, "google").id && client(env, "google").secret),
    github: enabled && validOrigin && Boolean(client(env, "github").id && client(env, "github").secret),
  };
}
function sign(data: string, env: Env) {
  return createHmac("sha256", secureKey(env)).update(data).digest("base64url");
}
function pack(payload: object, env: Env) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return data + "." + sign(data, env);
}
function unpack(value: string | undefined, env: Env): Record<string, unknown> | undefined {
  if (!value || value.length > 6000 || secureKey(env).length < 32) return;
  const [data, mac, extra] = value.split(".");
  if (!data || !mac || extra !== undefined) return;
  const expected = sign(data, env);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return;
  try {
    const result: unknown = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
  } catch { return; }
}
function cookie(req: IncomingMessage, key: string): string | undefined {
  return (req.headers.cookie ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(key + "="))?.slice(key.length + 1);
}
function writeCookie(res: ServerResponse, key: string, value: string, maxAge: number) {
  const old = res.getHeader("set-cookie");
  const list = Array.isArray(old) ? old : old ? [String(old)] : [];
  res.setHeader("set-cookie", [...list, key + "=" + value +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge]);
}
function answer(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(JSON.stringify(data));
}
function redirect(res: ServerResponse, url: string) {
  res.writeHead(302, {"location":url,"cache-control":"no-store","referrer-policy":"no-referrer"});res.end();
}
function requestOrigin(req: IncomingMessage, env: Env) {
  const intended = new URL(origin(env));
  if (req.headers.host !== intended.host ||
    (req.headers["x-forwarded-host"] && req.headers["x-forwarded-host"] !== intended.host))
    throw new Error("PUBLIC_AUTH_HOST_DENIED");
  return intended.origin;
}
function callbackFor(provider: SocialProvider, env: Env) {
  return origin(env) + "/api/auth/social/" + provider + "/callback";
}
function returnTo(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") ||
      raw.includes("\r") || raw.includes("\n")) return "/";
  return raw.slice(0,200);
}
function isOwner(env: Env, provider: SocialProvider, sub: string) {
  const list = provider === "github" ? env.OSA_GITHUB_ALLOWED_USER_IDS : env.OSA_GOOGLE_OWNER_SUBJECTS;
  return (list ?? "").split(",").map(v => v.trim()).filter(Boolean).includes(sub);
}
function identityOf(provider: SocialProvider, sub: string, name: string, email: string | undefined, env: Env): Identity {
  const owner = isOwner(env, provider, sub);
  // Visitors are authenticated but not provisioned. NEVER reuse owner tenant or memory.
  return {
    provider, subject: sub, identity_id: provider + "_" + sub,
    display_name: name.slice(0,120), ...(email ? { email: email.slice(0,254) } : {}),
    ...(owner ? {
      organization_id: env.OSA_NEUROSA_ORGANIZATION_ID,
      project_ids: env.OSA_NEUROSA_PROJECT_ID ? [env.OSA_NEUROSA_PROJECT_ID] : [],
    } : {}),
    roles: owner ? ["owner","operator"] : ["visitor"], verified:true,
  };
}
export function readSocialSession(req: IncomingMessage, env: Env = process.env): SessionRecord | undefined {
  const claims = unpack(cookie(req, SESSION), env);
  if (!claims || claims.kind !== "osa.social.v1" || !providers.includes(claims.provider as SocialProvider) ||
    typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255 ||
    typeof claims.name !== "string" || claims.name.length > 120 ||
    typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
    claims.iat > Date.now() + 30_000 || claims.exp <= Date.now() ||
    claims.exp - claims.iat > SESSION_MS || typeof claims.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(claims.nonce)) return;
  const provider = claims.provider as SocialProvider;
  if (!publicProviderStatus(env)[provider]) return;
  const identity = identityOf(provider, claims.sub, claims.name, typeof claims.email === "string" ? claims.email : undefined, env);
  return {
    session_id:"ses_social_"+claims.nonce, token:"", identity,
    created_at:new Date(claims.iat).toISOString(),expires_at:new Date(claims.exp).toISOString(),
  };
}
async function googleProfile(token: Record<string, unknown>, clientId: string, nonce: string, fetcher: typeof fetch) {
  const jwt = token.id_token;
  if (typeof jwt !== "string" || jwt.length > 16000) throw new Error("GOOGLE_ID_TOKEN_MISSING");
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("GOOGLE_ID_TOKEN_INVALID");
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch { throw new Error("GOOGLE_ID_TOKEN_INVALID"); }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length > 180 ||
    !["https://accounts.google.com","accounts.google.com"].includes(String(claims.iss)) ||
    claims.aud !== clientId || typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now() ||
    typeof claims.iat !== "number" || claims.iat * 1000 > Date.now() + 30_000 ||
    claims.nonce !== nonce || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{3,255}$/.test(claims.sub))
    throw new Error("GOOGLE_ID_TOKEN_CLAIMS_REJECTED");
  const keysResponse = await fetcher("https://www.googleapis.com/oauth2/v3/certs",
    {signal:AbortSignal.timeout(8_000),redirect:"error"});
  if (!keysResponse.ok) throw new Error("GOOGLE_JWKS_UNAVAILABLE");
  const keys = await keysResponse.json() as {keys?: Array<Record<string, unknown>>};
  const jwk = keys.keys?.find(k => k.kid === header.kid && k.kty === "RSA" && k.use === "sig" && k.alg === "RS256");
  if (!jwk) throw new Error("GOOGLE_JWK_UNKNOWN");
  try {
    const key = createPublicKey({key:jwk as import("node:crypto").JsonWebKey,format:"jwk"});
    if (!verify("RSA-SHA256",Buffer.from(parts[0] + "." + parts[1]),key,Buffer.from(parts[2]!,"base64url")))
      throw new Error("GOOGLE_SIGNATURE_INVALID");
  } catch { throw new Error("GOOGLE_SIGNATURE_INVALID"); }
  return {sub:claims.sub,name: typeof claims.name === "string" ? claims.name : "Google user",
    email: claims.email_verified === true && typeof claims.email === "string" ? claims.email : undefined};
}
export async function handleSocialAuth(req: IncomingMessage, res: ServerResponse, env: Env = process.env,
  fetcher: typeof fetch = fetch): Promise<boolean> {
  const path = new URL(req.url ?? "/", "http://local").pathname;
  if (path === "/auth/social/status") {
    if (req.method !== "GET") { answer(res,405,{code:"METHOD_NOT_ALLOWED"});return true; }
    const session = readSocialSession(req,env);
    answer(res,200,{providers:publicProviderStatus(env),authenticated:Boolean(session),identity:session?.identity??null});
    return true;
  }
  if (path === "/auth/social/logout") {
    if (req.method !== "POST" || req.headers.origin !== origin(env) ||
      (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
      answer(res,403,{code:"LOGOUT_FORBIDDEN"});return true;
    }
    try { requestOrigin(req,env); } catch { answer(res,403,{code:"LOGOUT_FORBIDDEN"});return true; }
    writeCookie(res, SESSION,"",0); answer(res,200,{ok:true});return true;
  }
  const match = /^\/auth\/social\/(google|github)\/(start|callback)$/.exec(path);
  if (!match) return false;
  const provider = match[1] as SocialProvider, action = match[2];
  if (!publicProviderStatus(env)[provider]) { answer(res,503,{code:"PROVIDER_NOT_CONFIGURED"});return true; }
  try {
    requestOrigin(req,env);
    if (req.method !== "GET") throw new Error("METHOD_NOT_ALLOWED");
    const providerClient = client(env,provider);
    if (action === "start") {
      const nonce = randomBytes(24).toString("base64url"), verifier = randomBytes(32).toString("base64url");
      const returnPath = returnTo(new URL(req.url!,"http://local").searchParams.get("return_to"));
      const pending = {kind:"oauth",provider,nonce,verifier,returnPath,iat:Date.now()};
      writeCookie(res,PENDING,pack(pending,env),600);
      const state = pack({kind:"state",provider,nonce,iat:pending.iat},env);
      const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" :
        "https://github.com/login/oauth/authorize");
      url.searchParams.set("response_type","code");
      url.searchParams.set("client_id",providerClient.id);
      url.searchParams.set("redirect_uri",callbackFor(provider,env));
      url.searchParams.set("state",state);
      url.searchParams.set("scope",provider === "google" ? "openid profile email" : "read:user");
      url.searchParams.set("code_challenge",createHash("sha256").update(verifier).digest("base64url"));
      url.searchParams.set("code_challenge_method","S256");
      if (provider === "google") url.searchParams.set("nonce",nonce);
      redirect(res,url.toString());return true;
    }
    const query = new URL(req.url!,"http://local").searchParams;
    const pending = unpack(cookie(req,PENDING),env), state = unpack(query.get("state") ?? undefined,env);
    writeCookie(res,PENDING,"",0);
    if (!pending || !state || pending.kind !== "oauth" || state.kind !== "state" ||
      pending.provider !== provider || state.provider !== provider ||
      typeof pending.nonce !== "string" || pending.nonce !== state.nonce ||
      typeof pending.iat !== "number" || state.iat !== pending.iat ||
      Date.now()-pending.iat < 0 || Date.now()-pending.iat > PENDING_MS ||
      typeof pending.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(pending.verifier) ||
      typeof pending.returnPath !== "string" || returnTo(pending.returnPath) !== pending.returnPath)
      throw new Error("OAUTH_STATE_INVALID");
    const code = query.get("code");
    if (!code || !/^[A-Za-z0-9_.-]{4,500}$/.test(code)) throw new Error("OAUTH_CODE_INVALID");
    const endpoint = provider === "google" ? "https://oauth2.googleapis.com/token" :
      "https://github.com/login/oauth/access_token";
    const payload = new URLSearchParams({client_id:providerClient.id,client_secret:providerClient.secret,
      code,redirect_uri:callbackFor(provider,env),code_verifier:pending.verifier,grant_type:"authorization_code"});
    const tokenResponse = await fetcher(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(8_000),
      headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:payload.toString()});
    if (!tokenResponse.ok) throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
    const token = await tokenResponse.json() as Record<string, unknown>;
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
    let profile:{sub:string;name:string;email?:string};
    if (provider === "google") profile = await googleProfile(token,providerClient.id,pending.nonce,fetcher);
    else {
      const user = await fetcher("https://api.github.com/user",{redirect:"error",signal:AbortSignal.timeout(8_000),
        headers:{"authorization":"Bearer "+token.access_token,"accept":"application/vnd.github+json",
          "user-agent":"osa-proof-auth"}});
      if (!user.ok) throw new Error("GITHUB_USERINFO_UNAVAILABLE");
      const github = await user.json() as {id?:unknown;login?:unknown};
      if (typeof github.id !== "number" || !Number.isSafeInteger(github.id) || github.id <= 0 ||
        typeof github.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(github.login))
        throw new Error("GITHUB_USERINFO_INVALID");
      profile = {sub:String(github.id),name:github.login};
    }
    const now = Date.now();
    writeCookie(res,SESSION,pack({kind:"osa.social.v1",provider,sub:profile.sub,name:profile.name,
      email:profile.email,nonce:randomBytes(24).toString("base64url"),iat:now,exp:now+SESSION_MS},env),8*3600);
    redirect(res,pending.returnPath);
    return true;
  } catch(error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "AUTH_FAILURE";
    answer(res,400,{code});return true;
  }
}
