import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionRecord } from "../../../packages/contracts/src";
import { FileDurableJobStore, DurableConflict, type DurableScope } from "../../../packages/durable-execution/src";

type Env=NodeJS.ProcessEnv;
function send(res:ServerResponse,status:number,body:unknown) {
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(body));
}
export function durableSupported(env:Env=process.env):boolean {
  // Lambda storage is ephemeral, and Lambda processes cannot own a durable worker.
  return env.VERCEL!=="1" && Boolean(env.OSA_DURABLE_DIR?.trim());
}
function store(env:Env):FileDurableJobStore {
  if(!durableSupported(env))throw new DurableConflict("DURABLE_BACKEND_NOT_CONFIGURED");
  return new FileDurableJobStore(env.OSA_DURABLE_DIR!);
}
function scopeFor(session:SessionRecord,projectId:string):DurableScope {
  if(!session.identity.identity_id||!session.identity.organization_id||!projectId)
    throw new DurableConflict("DURABLE_SCOPE_REQUIRED");
  return {organization_id:session.identity.organization_id,identity_id:session.identity.identity_id,project_id:projectId};
}
function sameOrigin(req:IncomingMessage,env:Env) {
  if(req.headers["sec-fetch-site"]==="cross-site")return false;
  const origin=req.headers.origin;
  if(origin && !["http://"+req.headers.host,"https://"+req.headers.host].includes(origin))return false;
  if(env.VERCEL==="1"&&!origin)return false;
  return true;
}
export async function handleDurableRequest(
  req:IncomingMessage,res:ServerResponse,session:SessionRecord,projectId:string,env:Env=process.env
):Promise<void> {
  const u=new URL(req.url??"/","http://localhost");
  if(u.pathname==="/durable/status"&&req.method==="GET") {
    const configured=durableSupported(env);
    const healthy=configured&&await store(env).workerHealthy();
    return send(res,200,{enabled:healthy,persistence:configured?"PERSISTENT_FILESYSTEM_WITH_EXTERNAL_WORKER":"UNAVAILABLE",
      worker:healthy?"HEALTHY":"UNAVAILABLE",browser_independent:healthy,
      production_supported:env.VERCEL!=="1"});
  }
  if(!durableSupported(env))return send(res,503,{code:"DURABLE_BACKEND_NOT_CONFIGURED",
    error:"Trwałe wykonanie wymaga współdzielonego trwałego magazynu i osobnego workera. Zadanie nie zostało przyjęte."});
  if(req.method==="POST"&&u.pathname==="/durable/jobs"&&!sameOrigin(req,env))
    return send(res,403,{code:"DURABLE_ORIGIN_DENIED"});
  let scope:DurableScope;
  try{scope=scopeFor(session,projectId);}catch{return send(res,403,{code:"DURABLE_SCOPE_DENIED"});}
  const backend=store(env);
  if(req.method==="POST"&&u.pathname==="/durable/jobs"&&!(await backend.workerHealthy()))
    return send(res,503,{code:"DURABLE_WORKER_UNAVAILABLE",error:"Worker nie potwierdził gotowości. Zadanie nie zostało przyjęte."});
  if(req.method==="POST"&&u.pathname==="/durable/jobs"){
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>24000)return send(res,413,{code:"DURABLE_INPUT_TOO_LARGE"});chunks.push(Buffer.from(chunk));}
    let body:unknown;
    try {body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
    catch{return send(res,400,{code:"DURABLE_BAD_JSON"});}
    try {
      const {job,created}=await backend.submit(scope,body);
      return send(res,created?202:200,{...(await backend.publicStatus(job)),idempotent_replay:!created});
    }catch(e){
      if(e instanceof DurableConflict)return send(res,e.code==="DURABLE_ID_CONFLICT"?409:422,{code:e.code});
      return send(res,503,{code:"DURABLE_WRITE_UNCONFIRMED"});
    }
  }
  if(req.method==="GET"&&/^\/durable\/jobs\/exec_[a-f0-9-]{36}$/i.test(u.pathname)){
    try {
      const job=await backend.get(scope,u.pathname.slice("/durable/jobs/".length));
      if(!job)return send(res,404,{code:"DURABLE_JOB_NOT_FOUND"});
      return send(res,200,await backend.publicStatus(job));
    }catch{return send(res,503,{code:"DURABLE_READ_UNCONFIRMED"});}
  }
  return send(res,404,{code:"DURABLE_ROUTE_NOT_FOUND"});
}
