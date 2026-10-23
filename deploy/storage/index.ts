// Wąski adapter dostępu do Postgres. To nie jest drugi control plane/runtime.
// Klucz publiczny jest jawny; klucz prywatny istnieje tylko w środowisku OSA API.
import { PUBLIC_KEYS } from "./public-key.ts";
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const keys=new Map(Object.entries(PUBLIC_KEYS).map(([namespace,key])=>[namespace,crypto.subtle.importKey("spki",bytes(key),{name:"Ed25519"},false,["verify"])]));
const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const identifier=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9_.:@/-]{1,240}$/.test(v);
Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json(405,{code:"METHOD_NOT_ALLOWED"});
  try{
    const reader=req.body?.getReader(),parts:Uint8Array[]=[];let size=0;
    if(reader)try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>512000){await reader.cancel();return json(413,{code:"BODY_TOO_LARGE"});}parts.push(p.value);}}finally{reader.releaseLock();}
    const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
    const input=JSON.parse(new TextDecoder().decode(data));
    const signature=req.headers.get("x-osa-signature")||"",key=keys.get(input.namespace);
    if(!key||signature.length!==88||!await crypto.subtle.verify("Ed25519",await key,bytes(signature),data))return json(403,{code:"STORAGE_SIGNATURE_DENIED"});
    if(!Number.isSafeInteger(input.issued_at)||Math.abs(Date.now()-input.issued_at)>30000||typeof input.nonce!=="string"||!/^[a-f0-9-]{36}$/.test(input.nonce))return json(403,{code:"STORAGE_REQUEST_EXPIRED"});
    if(!identifier(input.namespace)||!identifier(input.scope)||!["executions","missions","provider_connections"].includes(input.kind)||!["get","list","put","delete"].includes(input.op)||input.op!=="list"&&!identifier(input.record_id))return json(400,{code:"STORAGE_INVALID_INPUT"});
    if(input.op==="list"&&(input.page_size!==5||input.cursor!==null&&!identifier(input.cursor)))return json(400,{code:"STORAGE_INVALID_PAGE"});
    const root=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!root||!secret)return json(503,{code:"STORAGE_BACKEND_UNAVAILABLE"});
    const url=new URL(root+"/rest/v1/osa_runtime_records");
    for(const name of ["namespace","scope","kind"])url.searchParams.set(name,"eq."+input[name]);
    if(input.op!=="list")url.searchParams.set("record_id","eq."+input.record_id);
    url.searchParams.set("select","record_id,revision,payload");
    if(input.op==="list"){
      // Niezmienny klucz, nie updated_at: checkpoint nie przesuwa wiersza między stronami.
      url.searchParams.set("order","record_id.asc");url.searchParams.set("limit","6");
      if(input.cursor!==null)url.searchParams.set("record_id","gt."+input.cursor);
    }
    const headers:Record<string,string>={authorization:"Bearer "+secret,apikey:secret,"content-type":"application/json",prefer:"return=representation"};
    let method="GET",body:string|undefined;
    if(input.op==="put"){
      if(input.payload===undefined||input.expected_revision!==null&&(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1))return json(400,{code:"STORAGE_INVALID_REVISION"});
      method=input.expected_revision===null?"POST":"PATCH";
      if(method==="POST"){
        url.search="";url.searchParams.set("select","record_id,revision,payload");
        body=JSON.stringify({namespace:input.namespace,scope:input.scope,kind:input.kind,record_id:input.record_id,revision:1,payload:input.payload});
      }else{url.searchParams.set("revision","eq."+input.expected_revision);body=JSON.stringify({revision:input.expected_revision+1,payload:input.payload,updated_at:new Date().toISOString()});}
    }
    if(input.op==="delete"){
      if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)return json(400,{code:"STORAGE_INVALID_REVISION"});
      method="DELETE";url.searchParams.set("revision","eq."+input.expected_revision);
    }
    const response=await fetch(url,{method,headers,body,redirect:"error",signal:AbortSignal.timeout(10000)});
    if(response.status===409)return json(409,{code:"STORAGE_REVISION_CONFLICT"});
    if(!response.ok)return json(503,{code:"STORAGE_DATABASE_UNAVAILABLE"});
    const rows=await response.json();
    if(["put","delete"].includes(input.op)&&rows.length!==1)return json(409,{code:"STORAGE_REVISION_CONFLICT"});
    if(input.op==="list"){
      const page=rows.slice(0,5);
      return json(200,{records:page,next_cursor:rows.length>5?page[page.length-1].record_id:null});
    }
    return json(200,input.op==="delete"?{removed:true}:{record:rows[0]??null});
  }catch{return json(503,{code:"STORAGE_REQUEST_FAILED"});}
});
