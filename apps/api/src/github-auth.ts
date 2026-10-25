import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionRecord } from "../../../packages/contracts/src";

type Env = Record<string, string | undefined>;
const OAUTH_COOKIE = "__Host-osa_oauth";
const SESSION_COOKIE = "__Host-osa_session";
const PENDING_TTL = 10 * 60 * 1000;
const SESSION_TTL = 8 * 60 * 60 * 1000;

export function githubOAuthConfigured(env: Env): boolean {
  const ids = env.OSA_GITHUB_ALLOWED_USER_IDS?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
  return Boolean(env.OSA_GITHUB_CLIENT_ID && env.OSA_GITHUB_CLIENT_SECRET &&
    env.OSA_GITHUB_SESSION_SECRET && env.OSA_GITHUB_SESSION_SECRET.length >= 32 &&
    env.OSA_GITHUB_CALLBACK_ORIGIN && ids.length && ids.every(id => /^[0-9]+$/.test(id)));
}
function ensureConfigured(env: Env): void {
  if (!githubOAuthConfigured(env)) throw new Error("GITHUB_OAUTH_NOT_CONFIGURED");
}
function allowedOrigin(raw: string, env: Env): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error("OAUTH_ORIGIN_INVALID");
  const host = url.hostname.toLowerCase();
  const allowedCustom = (env.OSA_GITHUB_ALLOWED_ORIGINS ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const preview = host === "osa-proof-three.vercel.app" || /^osa-proof(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host);
  if (!preview && !allowedCustom.includes(url.origin)) throw new Error("OAUTH_ORIGIN_DENIED");
  return url.origin;
}
function originOf(request: IncomingMessage, env: Env): string {
  const hostname = request.headers.host;
  if (!hostname || typeof hostname !== "string") throw new Error("OAUTH_HOST_INVALID");
  return allowedOrigin("https://" + hostname + "/", env);
}
function callbackOrigin(env: Env): string {
  return allowedOrigin(env.OSA_GITHUB_CALLBACK_ORIGIN ?? "", env);
}
function base64url(value: string | Buffer): string { return Buffer.from(value).toString("base64url"); }
function signature(content: string, secret: string): string {
  return createHmac("sha256", secret).update(content).digest("base64url");
}
function encodeSigned(value: unknown, env: Env): string {
  const data = base64url(JSON.stringify(value));
  return data + "." + signature(data, env.OSA_GITHUB_SESSION_SECRET!);
}
function decodeSigned(value: string | undefined, env: Env): Record<string, unknown> | undefined {
  if (!value || !env.OSA_GITHUB_SESSION_SECRET || value.length > 6000) return;
  const [data, mac, extra] = value.split(".");
  if (!data || !mac || extra !== undefined) return;
  const expected = signature(data, env.OSA_GITHUB_SESSION_SECRET);
  const left = Buffer.from(mac), right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return;
  try {
    const json = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return json && typeof json === "object" && !Array.isArray(json) ? json : undefined;
  } catch { return; }
}
function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  const value = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return value?.slice(name.length + 1);
}
function setCookie(res: ServerResponse, name: string, value: string, maxAge: number, sameSite: "Lax" | "None"): void {
  const previous = res.getHeader("set-cookie");
  const list = Array.isArray(previous) ? previous : previous ? [String(previous)] : [];
  res.setHeader("set-cookie", [...list, name + "=" + value +
    "; Path=/; HttpOnly; Secure; SameSite=" + sameSite + "; Max-Age=" + maxAge]);
}
function respond(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(JSON.stringify(body));
}
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, {location,"cache-control":"no-store","referrer-policy":"no-referrer"}); res.end();
}
function safeError(res: ServerResponse, status: number, code: string): void { respond(res,status,{ok:false,code}); }
function safeReturnPath(input: string | null): string {
  if (!input || !input.startsWith("/") || input.startsWith("//") || input.includes("\\") || input.includes("\r") || input.includes("\n")) return "/";
  return input.slice(0,200);
}
function sameOriginPost(req: IncomingMessage, env: Env): boolean {
  try {
    return req.method === "POST" && req.headers.origin === originOf(req, env) &&
      (!req.headers["sec-fetch-site"] || ["same-origin", "same-site"].includes(req.headers["sec-fetch-site"] as string));
  } catch { return false; }
}
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) throw new Error("OAUTH_FORM_INVALID");
  const parts:Buffer[]=[];let bytes=0;
  for await (const part of req) {
    bytes+=Buffer.byteLength(part);
    if (bytes>4096) throw new Error("OAUTH_FORM_TOO_LARGE");
    parts.push(Buffer.from(part));
  }
  return new URLSearchParams(Buffer.concat(parts).toString("utf8"));
}
function allowedGithubId(id: unknown, env: Env): boolean {
  return typeof id === "number" && Number.isSafeInteger(id) && id>0 &&
    (env.OSA_GITHUB_ALLOWED_USER_IDS??"").split(",").map(v=>v.trim()).includes(String(id));
}
export function readGithubSession(req: IncomingMessage, env: Env = process.env): SessionRecord | undefined {
  if (!githubOAuthConfigured(env)) return;
  const signed = decodeSigned(cookie(req,SESSION_COOKIE),env);
  if (signed?.kind!=="session" || typeof signed.exp!=="number" || signed.exp<=Date.now() ||
    typeof signed.iat!=="number" || signed.iat>Date.now()+30000 || signed.exp-signed.iat>SESSION_TTL ||
    !allowedGithubId(signed.github_id,env) ||
    typeof signed.github_login!=="string" || !/^[a-z0-9-]{1,39}$/i.test(signed.github_login) ||
    typeof signed.nonce!=="string" || !/^[A-Za-z0-9_-]{20,100}$/.test(signed.nonce)) return;
  const id=String(signed.github_id);
  return {session_id:"ses_gh_"+String(signed.nonce),token:"",
    identity:{identity_id:"github_"+id,provider:"github",subject:id,display_name:String(signed.github_login),
      organization_id:env.OSA_GITHUB_ORGANIZATION_ID,
      project_ids:env.OSA_GITHUB_PROJECT_ID?[env.OSA_GITHUB_PROJECT_ID]:[],
      roles:["operator"],verified:true},
    created_at:new Date(signed.iat).toISOString(),expires_at:new Date(signed.exp).toISOString()};
}

/** Stable broker callback, dynamic source Preview, PKCE, HttpOnly state and one-use GitHub code. */
export async function handleGithubAuth(req: IncomingMessage, res: ServerResponse, env: Env = process.env,
  fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const pathname = new URL(req.url??"/","http://local").pathname;
  if (!["/auth/github/start","/auth/github/callback","/auth/github/complete","/auth/github/status","/auth/github/logout"].includes(pathname)) return false;
  if (pathname==="/auth/github/status") {
    if (req.method!=="GET") {safeError(res,405,"METHOD_NOT_ALLOWED");return true;}
    const user=readGithubSession(req,env);
    respond(res,200,{configured:githubOAuthConfigured(env),authenticated:Boolean(user),identity:user?.identity ?? null});
    return true;
  }
  if (!githubOAuthConfigured(env)) {safeError(res,503,"GITHUB_OAUTH_NOT_CONFIGURED");return true;}
  try {
    if (pathname==="/auth/github/start") {
      if (req.method!=="GET") throw new Error("METHOD_NOT_ALLOWED");
      const origin=originOf(req,env);
      const nonce=randomBytes(24).toString("base64url");
      const verifier=randomBytes(32).toString("base64url");
      const returnPath=safeReturnPath(new URL(req.url!,"http://local").searchParams.get("return_to"));
      const state=encodeSigned({kind:"oauth",nonce,origin,returnPath,iat:Date.now()},env);
      setCookie(res,OAUTH_COOKIE,encodeSigned({nonce,verifier,iat:Date.now()},env),600,"None");
      const redirectUri=callbackOrigin(env)+"/api/auth/github/callback";
      const authorize=new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id",env.OSA_GITHUB_CLIENT_ID!);
      authorize.searchParams.set("redirect_uri",redirectUri);
      authorize.searchParams.set("scope","read:user");
      authorize.searchParams.set("state",state);
      authorize.searchParams.set("code_challenge",createHash("sha256").update(verifier).digest("base64url"));
      authorize.searchParams.set("code_challenge_method","S256");
      redirect(res,authorize.toString());
      return true;
    }
    if (pathname==="/auth/github/callback") {
      if (req.method!=="GET" || originOf(req,env)!==callbackOrigin(env)) throw new Error("OAUTH_CALLBACK_ORIGIN_MISMATCH");
      const url=new URL(req.url!,"http://local");
      const state=url.searchParams.get("state")??"";
      const code=url.searchParams.get("code")??"";
      const claims=decodeSigned(state,env);
      if (claims?.kind!=="oauth" || typeof claims.nonce!=="string" || typeof claims.iat!=="number" ||
        Date.now()-claims.iat<0 || Date.now()-claims.iat>PENDING_TTL ||
        typeof claims.origin!=="string" || allowedOrigin(claims.origin,env)!==claims.origin ||
        typeof claims.returnPath!=="string" || safeReturnPath(claims.returnPath)!==claims.returnPath ||
        !/^[a-zA-Z0-9_]+$/.test(code)) throw new Error("OAUTH_STATE_INVALID");
      // POST to the originating deployment; no token in URL and no cross-origin JS access.
      const dest=claims.origin+"/api/auth/github/complete";
      const esc=(str:string)=>str.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
      const html='<html><head><meta name="referrer" content="no-referrer"></head><body><form method="POST" action="'+esc(dest)+'">'+
        '<input type="hidden" name="code" value="'+esc(code)+'"><input type="hidden" name="state" value="'+esc(state)+'"></form>'+
        '<script nonce="osa-bridge">document.forms[0].submit()</script></body></html>';
      res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer",
        "content-security-policy":"default-src 'none'; base-uri 'none'; form-action "+claims.origin+"; script-src 'nonce-osa-bridge'",
        "x-content-type-options":"nosniff"});
      res.end(html);return true;
    }
    if (pathname==="/auth/github/complete") {
      if (req.method!=="POST") throw new Error("METHOD_NOT_ALLOWED");
      // Cross-site top-level POST from our canonical broker: validate signed state and nonce instead of Origin.
      const form=await readForm(req);
      const claims=decodeSigned(form.get("state")??undefined,env);
      const pending=decodeSigned(cookie(req,OAUTH_COOKIE),env);
      setCookie(res,OAUTH_COOKIE,"",0,"None");
      if (claims?.kind!=="oauth" || typeof claims.origin!=="string" || claims.origin!==originOf(req,env) ||
        typeof claims.nonce!=="string" || claims.nonce!==pending?.nonce ||
        typeof claims.iat!=="number" || Date.now()-claims.iat>PENDING_TTL || Date.now()-claims.iat<0 ||
        typeof pending?.iat!=="number" || Date.now()-pending.iat>PENDING_TTL ||
        typeof pending.verifier!=="string" || !/^[a-zA-Z0-9_-]{43,128}$/.test(pending.verifier)) throw new Error("OAUTH_STATE_MISMATCH");
      const code=form.get("code");
      if (!code || !/^[A-Za-z0-9_]+$/.test(code)) throw new Error("OAUTH_CODE_INVALID");
      const tokenResponse=await fetchImpl("https://github.com/login/oauth/access_token",{
        method:"POST",headers:{accept:"application/json","content-type":"application/json"},
        body:JSON.stringify({client_id:env.OSA_GITHUB_CLIENT_ID,client_secret:env.OSA_GITHUB_CLIENT_SECRET,
          code,code_verifier:pending.verifier,redirect_uri:callbackOrigin(env)+"/api/auth/github/callback"}),
        redirect:"error",signal:AbortSignal.timeout(8000)});
      if (!tokenResponse.ok) throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
      const tokenBody=await tokenResponse.json() as {access_token?:unknown;error?:unknown};
      if (tokenBody.error || typeof tokenBody.access_token!=="string" || !tokenBody.access_token) throw new Error("OAUTH_TOKEN_EXCHANGE_FAILED");
      const userResponse=await fetchImpl("https://api.github.com/user",{
        headers:{"authorization":"Bearer "+tokenBody.access_token,"accept":"application/vnd.github+json",
          "user-agent":"osa-proof-auth"},redirect:"error",signal:AbortSignal.timeout(8000)});
      if (!userResponse.ok) throw new Error("OAUTH_IDENTITY_FAILED");
      const github=await userResponse.json() as {id?:unknown;login?:unknown};
      if (!allowedGithubId(github.id,env) || typeof github.login!=="string" ||
        !/^[a-z0-9-]{1,39}$/i.test(github.login)) throw new Error("OAUTH_USER_NOT_ALLOWED");
      const now=Date.now();
      setCookie(res,SESSION_COOKIE,encodeSigned({kind:"session",github_id:github.id,
        github_login:github.login,iat:now,exp:now+SESSION_TTL,nonce:randomBytes(24).toString("base64url")},env),8*3600,"Lax");
      const returnPath=typeof claims.returnPath==="string"?safeReturnPath(claims.returnPath):"/";
      redirect(res,returnPath);
      return true;
    }
    if (pathname==="/auth/github/logout") {
      if (!sameOriginPost(req,env)) throw new Error("OAUTH_LOGOUT_CSRF");
      setCookie(res,SESSION_COOKIE,"",0,"Lax");
      respond(res,200,{ok:true});
      return true;
    }
  } catch (err) {
    const code=err instanceof Error && /^[A-Z_]+$/.test(err.message) ? err.message:"OAUTH_FAILURE";
    safeError(res,code==="OAUTH_USER_NOT_ALLOWED"?403:400,code);
    return true;
  }
  return true;
}
