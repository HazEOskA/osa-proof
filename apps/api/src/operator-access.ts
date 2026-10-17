import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionRecord } from "../../../packages/contracts/src";

type Env = Record<string, string | undefined>;
const COOKIE = "__Host-osa-operator";
const TTL = 30 * 60;
export function protectedRuntime(env: Env = process.env): boolean {
  return env.VERCEL === "1" || env.NODE_ENV === "production";
}
export function openVercelAccess(env: Env): boolean {
  return env.VERCEL === "1" && ["preview", "production"].includes(env.VERCEL_ENV ?? "") && env.OSA_AUTH_MODE?.trim() === "open";
}
function config(env: Env) {
  const token = env.OSA_OPERATOR_TOKEN?.trim();
  const organization = env.OSA_OPERATOR_ORGANIZATION_ID?.trim();
  const project = env.OSA_OPERATOR_PROJECT_ID?.trim();
  const raw = env.OSA_OPERATOR_ORIGIN || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined);
  if (!token || token.length < 32 || token.length > 4096 || !organization || !project || !raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return {token, organization, project, origin:url.origin};
  } catch { return undefined; }
}
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function signature(value: string, key: string): string {
  return createHmac("sha256", key).update("osa.operator.v1:" + value).digest("base64url");
}
export function operatorAccessStatus(env: Env) {
  const open = openVercelAccess(env);
  const required = protectedRuntime(env) && !open;
  return {required, configured:Boolean(config(env)), mode:required?"SCOPED_OPERATOR":open?(env.VERCEL_ENV === "production"?"OPEN_PRODUCTION":"OPEN_PREVIEW"):"LOCAL_DEVELOPMENT"};
}
export function operatorProject(env: Env): string | undefined { return config(env)?.project; }
export function operatorSession(request: IncomingMessage, env: Env, now = Date.now()): SessionRecord | undefined {
  const cfg = config(env);
  if (!cfg) return undefined;
  const cookie = request.headers.cookie?.split(";").map(v=>v.trim()).find(v=>v.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
  if (!cookie || cookie.length > 8192) return undefined;
  const [payload, mac, extra] = cookie.split(".");
  if (!payload || !mac || extra !== undefined || !equal(mac, signature(payload, cfg.token))) return undefined;
  try {
    const v = JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    const seconds = Math.floor(now/1000);
    if (v.v!==1 || v.org!==cfg.organization || v.project!==cfg.project || v.aud!==cfg.origin ||
        !Number.isSafeInteger(v.iat) || !Number.isSafeInteger(v.exp) || v.iat>seconds || v.exp<=seconds || v.exp-v.iat!==TTL || typeof v.id!=="string") return undefined;
    return {session_id:v.id, token:"", identity:{identity_id:"idn_operator", provider:"local-dev", subject:"operator:server-verified",
      display_name:"Operator OSA", organization_id:cfg.organization, roles:["operator"], verified:true},
      created_at:new Date(v.iat*1000).toISOString(), expires_at:new Date(v.exp*1000).toISOString()};
  } catch { return undefined; }
}
export function operatorOriginAllowed(request: IncomingMessage, env: Env): boolean {
  const cfg = config(env);
  return Boolean(cfg && request.headers.origin === cfg.origin && (!request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin"));
}
export async function handleOperatorAuth(request: IncomingMessage, response: ServerResponse, path: string, env: Env): Promise<boolean> {
  if (!["/auth/access","/auth/operator-login","/auth/operator-logout"].includes(path)) return false;
  const send = (status:number, body:unknown) => { response.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});response.end(JSON.stringify(body)); };
  if (path==="/auth/access" && request.method==="GET") {
    const session=operatorSession(request,env);
    send(200,{...operatorAccessStatus(env),authenticated:Boolean(session),scope:session?{organization_id:session.identity.organization_id,project_id:operatorProject(env)}:null}); return true;
  }
  if (request.method!=="POST") { send(405,{error:"Ta trasa wymaga metody POST."});return true; }
  const cfg = config(env);
  if (!cfg) {send(503,{code:"OPERATOR_ACCESS_NOT_CONFIGURED",error:"Dostęp operatora wymaga konfiguracji po stronie serwera."});return true;}
  if (!operatorOriginAllowed(request,env)) {send(403,{code:"ORIGIN_DENIED",error:"Niedozwolone pochodzenie żądania."});return true;}
  if (path==="/auth/operator-logout") {
    response.setHeader("set-cookie",`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
    send(200,{authenticated:false});return true;
  }
  let bytes=0;const chunks:Buffer[]=[];
  for await(const chunk of request) {const b=Buffer.from(chunk);bytes+=b.length;if(bytes>8192){send(413,{error:"Żądanie jest za duże."});return true;}chunks.push(b);}
  let value:unknown;
  try {value=JSON.parse(Buffer.concat(chunks).toString("utf8"));} catch {send(400,{error:"Nieprawidłowy JSON."});return true;}
  const token=(value as {token?:unknown}|null)?.token;
  if(typeof token!=="string" || !equal(token,cfg.token)){send(401,{code:"OPERATOR_LOGIN_DENIED",error:"Nieprawidłowy kod dostępu operatora."});return true;}
  const iat=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({v:1,id:"ses_operator_"+randomUUID(),org:cfg.organization,project:cfg.project,aud:cfg.origin,iat,exp:iat+TTL})).toString("base64url");
  response.setHeader("set-cookie",`${COOKIE}=${payload}.${signature(payload,cfg.token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL}`);
  send(200,{authenticated:true,expires_in:TTL});return true;
}
