// Lokalny harness: wykonuje rzeczywisty deploy/storage/index.ts, podpisy i CAS.
// PostgREST/Docker/model pozostają jawnie FIXTURE; żadnych wywołań chmurowych.
import { createPrivateKey, createPublicKey, webcrypto, randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { ApiState, handleApiRequest } from "../apps/api/src";
import { DurableStore } from "../apps/api/src/durable-store";
import { BrainControlPlane } from "../packages/brain/src";
import { ExecutorRegistry } from "../packages/runtime/src";
import type { DockerCli } from "../packages/workspace-runtime/src/docker";
import { contractStore, contractMemory } from "./p1-fix-01-fixtures";

export function storage02() {
  const base=contractStore(), rows=new Map<string,any>();let handler!:(req:Request)=>Promise<Response>;
  let unavailable=false,rejectCompletion=false;const queries:string[]=[];
  const publicKey=createPublicKey(createPrivateKey({key:Buffer.from(base.env.OSA_STORAGE_PRIVATE_KEY_B64,"base64"),format:"der",type:"pkcs8"})).export({format:"der",type:"spki"}).toString("base64");
  const backend=async(url:URL,init:RequestInit)=>{
    queries.push(url.toString());if(unavailable)return new Response("FIXTURE_STORAGE_DOWN",{status:503});
    const p=url.searchParams, matches=(row:any)=>["namespace","scope","kind","record_id","revision"].every(k=>{
      const filter=p.get(k);return !filter||(filter.startsWith("eq.")?String(row[k])===filter.slice(3):filter.startsWith("gt.")?row[k]>filter.slice(3):false);
    });
    const key=(r:any)=>JSON.stringify([r.namespace,r.scope,r.kind,r.record_id]);
    if(init.method==="POST"){
      const r=JSON.parse(String(init.body));if(rejectCompletion&&r.payload.state==="COMPLETED")return new Response("",{status:503});
      if(rows.has(key(r)))return new Response("",{status:409});rows.set(key(r),r);return Response.json([r]);
    }
    let found=[...rows.values()].filter(matches);
    if(init.method==="PATCH"){
      const patch=JSON.parse(String(init.body));if(rejectCompletion&&patch.payload.state==="COMPLETED")return new Response("",{status:503});
      for(const r of found)Object.assign(r,patch);return Response.json(found);
    }
    if(init.method==="DELETE"){for(const r of found)rows.delete(key(r));return Response.json(found);}
    found.sort((a,b)=>p.get("order")==="record_id.asc"?a.record_id.localeCompare(b.record_id):[...rows.values()].indexOf(b)-[...rows.values()].indexOf(a));
    return Response.json(found.slice(0,Number(p.get("limit")||1000)).map(({record_id,revision,payload})=>({record_id,revision,payload})));
  };
  const source=readFileSync("deploy/storage/index.ts","utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled,{exports:{},require:(id:string)=>{if(id!=="./public-key.ts")throw Error("FIXTURE_IMPORT_DENIED");return {PUBLIC_KEYS:{[base.env.OSA_STORAGE_NAMESPACE]:publicKey}};},
    Deno:{serve:(fn:typeof handler)=>handler=fn,env:{get:(key:string)=>key==="SUPABASE_URL"?"https://fixture-db.invalid":key==="SUPABASE_SERVICE_ROLE_KEY"?"FIXTURE_SERVICE_ROLE":undefined}},
    crypto:webcrypto,atob,Uint8Array,TextDecoder,Response,URL,AbortSignal,fetch:backend});
  const fetcher=(async(_url,init)=>handler(new Request(base.env.OSA_STORAGE_URL,init))) as typeof fetch;
  return {env:base.env,rows,queries,fetch:fetcher,store:new DurableStore(base.env,fetcher),setUnavailable:(v:boolean)=>unavailable=v,setRejectCompletion:(v:boolean)=>rejectCompletion=v};
}
export const identity02={identity_id:"fix02",provider:"microsoft" as const,subject:"FIXTURE_FIX02",display_name:"Test FIX02",verified:true,roles:[],organization_id:"org_fix",project_ids:["osa-proof"]};
export async function request02(state:ApiState,path:string,payload?:unknown,identity=identity02){
  const session=state.sessions.create(identity),req=Readable.from(payload===undefined?[]:[Buffer.from(JSON.stringify(payload))]) as any;
  Object.assign(req,{url:path,method:payload===undefined?"GET":"POST",headers:{authorization:"Bearer "+session.token}});
  let status=0,body:any;const res={setHeader(){},writeHead(v:number){status=v;},end(v:string){body=JSON.parse(v);}} as any;
  await handleApiRequest(req,res,new ExecutorRegistry(),state);return {status,body};
}
export function chat02(enabled=true,storage=storage02()){
  const memory=contractMemory(),env={...storage.env,NVIDIA_API_KEY:"FIXTURE_MODEL_"+randomUUID(),OPENROUTER_API_KEY:"FIXTURE_ROUTER_"+randomUUID(),OPENROUTER_MODEL:"openrouter/free"};
  const state=()=>new ApiState(undefined,undefined,undefined,"session",undefined,enabled?new BrainControlPlane(undefined,memory.adapter):undefined,undefined,env);
  return {memory,storage,env,state};
}
export const message02=(provider="nvidia")=>({provider,prompt:"syntetyczne zadanie FIX02",conversation_id:randomUUID(),execution_id:"exec_"+randomUUID(),remember:true});
export function model02(text="odpowiedź FIX02"){return Response.json({id:"FIXTURE_MODEL",model:"fixture",choices:[{finish_reason:"stop",message:{content:text}}],usage:{prompt_tokens:1,completion_tokens:1}});}

export function docker02(){
  const containers=new Map<string,any>();const calls:string[][]=[];let unavailable=false,rejectRemove=false,execFailure=false;
  const cli:DockerCli={run:async(args)=>{
    calls.push([...args]);const id=args.at(-1)!;
    if(unavailable)return {exitCode:1,stdout:"",stderr:"Cannot connect to the Docker daemon"};
    if(args[0]==="run"){
      const labels:Record<string,string>={};args.forEach((v,i)=>{if(v==="--label"){const [k,...rest]=args[i+1].split("=");labels[k]=rest.join("=");}});
      const containerId=createHash("sha256").update(randomUUID()).digest("hex");containers.set(containerId,{Id:containerId,Name:args[args.indexOf("--name")+1],Config:{Labels:labels}});
      return {exitCode:0,stdout:containerId+"\n",stderr:""};
    }
    if(args[0]==="inspect")return containers.has(id)?{exitCode:0,stdout:JSON.stringify([containers.get(id)]),stderr:""}:{exitCode:1,stdout:"[]",stderr:"Error response from daemon: No such container: "+id};
    if(args[0]==="rm"){
      if(rejectRemove)return {exitCode:1,stdout:"",stderr:"FIXTURE_REMOVE_DENIED"};
      const target=[...containers.entries()].find(([key,r])=>key===id||r.Name===id)?.[0]??id;const existed=containers.delete(target);return {exitCode:existed?0:1,stdout:existed?id:"",stderr:existed?"":"Error response from daemon: No such container: "+id};
    }
    if(args[0]==="exec")return {exitCode:execFailure?1:0,stdout:JSON.stringify({uid:1000,sha256:createHash("sha256").update(id).digest("hex")}),stderr:""};
    return {exitCode:1,stdout:"",stderr:"FIXTURE_COMMAND_DENIED"};
  }};
  return {cli,containers,calls,setUnavailable:(v:boolean)=>unavailable=v,setRejectRemove:(v:boolean)=>rejectRemove=v,setExecFailure:(v:boolean)=>execFailure=v};
}
