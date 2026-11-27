import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DurableScope } from "../../../packages/durable-execution/src";
import { readBoundedResponse } from "../../../packages/deployment/src";

export type DurableRemoteConfig={url:string;token:string;scope:DurableScope};
export function remoteDurableConfig(env:NodeJS.ProcessEnv):DurableRemoteConfig|undefined{
  const token=env.OSA_DURABLE_REMOTE_TOKEN?.trim();
  const scope={organization_id:env.OSA_DURABLE_REMOTE_ORGANIZATION_ID?.trim()||"",identity_id:env.OSA_DURABLE_REMOTE_IDENTITY_ID?.trim()||"",project_id:env.OSA_DURABLE_REMOTE_PROJECT_ID?.trim()||""};
  if(!token||token.length<32||Object.values(scope).some(v=>!v||v.length>200||!/^[a-zA-Z0-9_.:@-]+$/.test(v)))return;
  try{
    const url=new URL(env.OSA_DURABLE_REMOTE_URL||"");
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")return;
    return {url:url.origin,token,scope};
  }catch{return;}
}
export function sameDurableScope(a:DurableScope,b:DurableScope):boolean{
  return a.organization_id===b.organization_id&&a.identity_id===b.identity_id&&a.project_id===b.project_id;
}
export function durableScopeDigest(scope:DurableScope):string{
  return createHash("sha256").update(JSON.stringify([scope.organization_id,scope.identity_id,scope.project_id])).digest("hex");
}
export function durableRoute(method:string|undefined,path:string):boolean{
  const job=/^\/durable\/jobs\/exec_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  return method==="GET"&&(path==="/durable/status"||job.test(path))||
    method==="POST"&&(path==="/durable/jobs"||(path.endsWith("/cancel")&&job.test(path.slice(0,-7))));
}
function send(res:ServerResponse,status:number,body:unknown){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(body));}
export async function forwardDurable(req:IncomingMessage,res:ServerResponse,scope:DurableScope,config:DurableRemoteConfig,fetcher:typeof fetch=fetch):Promise<void>{
  if(!sameDurableScope(scope,config.scope))return send(res,403,{code:"DURABLE_REMOTE_SCOPE_DENIED"});
  // Durable routes have no query parameters. Vercel may preserve rewrite metadata.
  // Match the exact raw path, without decoding, traversal normalization or forwarding query data.
  const path=(req.url||"").split("?",1)[0];
  if(!durableRoute(req.method,path))return send(res,404,{code:"DURABLE_ROUTE_NOT_FOUND"});
  const chunks:Buffer[]=[];let size=0;
  if(req.method==="POST")for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>24000)return send(res,413,{code:"DURABLE_INPUT_TOO_LARGE"});chunks.push(Buffer.from(chunk));}
  try{
    const result=await fetcher(config.url+path,{method:req.method,headers:{authorization:"Bearer "+config.token,"content-type":"application/json","x-osa-durable-scope":durableScopeDigest(scope)},body:req.method==="POST"?Buffer.concat(chunks).toString("utf8"):undefined,redirect:"error",signal:AbortSignal.timeout(8000)});
    if(result.headers.get("x-osa-durable-bridge")!=="v1")throw Error("REMOTE_PROTOCOL_UNCONFIRMED");
    const body=JSON.parse(await readBoundedResponse(result,2*1024*1024));
    if(!body||typeof body!=="object"||Array.isArray(body))throw Error("INVALID_REMOTE_RESPONSE");
    if(result.status===401||result.status>=500)throw Error("REMOTE_UNAVAILABLE");
    if(path==="/durable/status"&&result.ok)return send(res,200,{...body,production_supported:body.enabled===true&&body.worker==="HEALTHY"&&body.browser_independent===true});
    return send(res,result.status,body);
  }catch{
    if(path==="/durable/status")return send(res,200,{enabled:false,persistence:"UNAVAILABLE",worker:"UNAVAILABLE",browser_independent:false,sandbox_configured:false,production_supported:false});
    return send(res,503,{code:"DURABLE_REMOTE_UNCONFIRMED"});
  }
}
