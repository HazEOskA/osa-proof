// Wyłącznie lokalne kontrakty: provider, Worker i Brain API są FIXTURE.
// SQLite poniżej służy tylko do testu restartu/CAS, nie zastępuje produkcyjnego storage.
import { generateKeyPairSync, verify, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DurableStore, type StoredRecord } from "../apps/api/src/durable-store";
import { digest } from "../packages/proof-core/src";
import { NeurosaMemoryAdapter } from "../packages/adapters/src/brain";

export const SQLITE_RPC = `
import sqlite3,json,sys
p=json.load(sys.stdin); db=sqlite3.connect(sys.argv[1],timeout=10)
db.execute('CREATE TABLE IF NOT EXISTS records (scope TEXT,kind TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(scope,kind,id))')
db.execute('BEGIN IMMEDIATE')
k=(p['namespace']+':'+p['scope'],p['kind'],p.get('record_id',''))
def row(r): return {'record_id':r[0],'revision':r[1],'payload':json.loads(r[2])} if r else None
status=200
if p['op']=='get': out={'record':row(db.execute('SELECT id,revision,payload FROM records WHERE scope=? AND kind=? AND id=?',k).fetchone())}
elif p['op']=='list':
 page=[row(r) for r in db.execute('SELECT id,revision,payload FROM records WHERE scope=? AND kind=? AND id>? ORDER BY id LIMIT 6',(*k[:2],p.get('cursor') or ''))]
 out={'records':page[:5],'next_cursor':page[4]['record_id'] if len(page)>5 else None}
else:
 try:
  if p['expected_revision'] is None: db.execute('INSERT INTO records VALUES(?,?,?,1,?)',(*k,json.dumps(p['payload'])))
  else:
   c=db.execute('UPDATE records SET revision=revision+1,payload=? WHERE scope=? AND kind=? AND id=? AND revision=?',(json.dumps(p['payload']),*k,p['expected_revision']))
   if c.rowcount!=1: raise sqlite3.IntegrityError('CAS')
  out={'record':row(db.execute('SELECT id,revision,payload FROM records WHERE scope=? AND kind=? AND id=?',k).fetchone())}
 except sqlite3.IntegrityError: status=409;out={}
db.commit();db.close();print(json.dumps({'status':status,'body':out}))
`;
export function contractStore(sqliteFile?: string) {
  const pair=generateKeyPairSync("ed25519"), records=new Map<string,StoredRecord>();
  const env={OSA_STORAGE_URL:"https://p1-fix-contract.supabase.co/functions/v1/osa-proof-storage",OSA_STORAGE_NAMESPACE:"p1-fix-local",
    OSA_STORAGE_PRIVATE_KEY_B64:pair.privateKey.export({format:"der",type:"pkcs8"}).toString("base64")};
  let unavailable=false, rejectCompletion=false;
  const fetcher=(async(_url,init)=>{
    if(unavailable)return new Response("FIXTURE_UNAVAILABLE",{status:503});
    const raw=String(init?.body);
    if(!verify(null,Buffer.from(raw),pair.publicKey,Buffer.from((init?.headers as Record<string,string>)["x-osa-signature"],"base64")))return new Response("",{status:403});
    const p=JSON.parse(raw);
    if(rejectCompletion&&p.op==="put"&&p.payload?.state==="COMPLETED")return new Response("FIXTURE_COMPLETION_UNCONFIRMED",{status:503});
    if(sqliteFile){
      const child=spawnSync("python3",["-c",SQLITE_RPC,sqliteFile],{input:raw,encoding:"utf8"});
      if(child.status!==0)throw Error("FIXTURE_SQLITE_RPC_FAILED");
      const result=JSON.parse(child.stdout);return Response.json(result.body,{status:result.status});
    }
    const key=p.namespace+":"+p.scope+":"+p.kind+":"+p.record_id, saved=records.get(key);
    if(p.op==="put"){
      // Tak jak serwer deploy/storage: INSERT bez upsert; UPDATE wymaga rewizji.
      if(p.expected_revision===null?saved!==undefined:!saved||saved.revision!==p.expected_revision)return new Response("",{status:409});
      const record={record_id:p.record_id,revision:(saved?.revision??0)+1,payload:structuredClone(p.payload)};
      records.set(key,record);return Response.json({record});
    }
    if(p.op==="list"){
      const rows=[...records.entries()].filter(([key])=>key.startsWith(p.namespace+":"+p.scope+":"+p.kind+":")).map(([,v])=>v)
        .filter(r=>p.cursor===null||r.record_id>p.cursor).sort((a,b)=>a.record_id<b.record_id?-1:a.record_id>b.record_id?1:0).slice(0,6);
      return Response.json({records:rows.slice(0,5),next_cursor:rows.length>5?rows[4].record_id:null});
    }
    return Response.json({record:saved??null});
  }) as typeof fetch;
  return {env,fetch:fetcher,store:new DurableStore(env,fetcher),records,setUnavailable(value:boolean){unavailable=value;},setRejectCompletion(value:boolean){rejectCompletion=value;}};
}
export function contractMemory() {
  const documents=new Map<string,unknown>();let available=true, writes=true, failProvenance=false, requests=0;
  const adapter=new NeurosaMemoryAdapter({baseUrl:"https://p1-fix-brain.invalid",token:"P1_FIX_SYNTHETIC_BRAIN_TOKEN_123456",brainId:"brain_fix",organizationId:"org_fix",projectId:"osa-proof",
    fetch:async(url,init)=>{
      requests++;if(!available)return new Response("FIXTURE_UNAVAILABLE",{status:503});
      const path=new URL(String(url)).pathname;
      if(path.endsWith("brain/status"))return Response.json({brainId:"brain_fix",ledgerValid:true});
      if(path.endsWith("brain/recall"))return Response.json({brainId:"brain_fix",ledgerValid:true,text:"syntetyczny kontekst P1 FIX",ledgerHead:"FIXTURE_LEDGER",references:[],truncated:false});
      if(path.includes("/documents/"))return Response.json(documents.get(path.split("/").at(-1)!));
      if(!writes)return new Response("FIXTURE_WRITE_REJECTED",{status:503});
      const body=JSON.parse(String(init?.body)),event=JSON.parse(body.content),id="doc_"+event.event_sha256,deduplicated=documents.has(id);
      if(failProvenance&&event.kind==="CHAT_PROVENANCE")return new Response("FIXTURE_PROVENANCE_REJECTED",{status:503});
      const document={documentId:id,revision:1,content:body.content,contentHash:createHash("sha256").update(body.content).digest("hex")};
      documents.set(id,document);return Response.json({status:"ZAPAMIĘTANO",document,acceptedRevision:1,deduplicated});
    }});
  return {adapter,documents,get requests(){return requests;},setAvailable(value:boolean){available=value;},setWrites(value:boolean){writes=value;},setFailProvenance(value:boolean){failProvenance=value;}};
}

// Wyłącznie symulowane potwierdzenie po wykonanej operacji usunięcia fixture.
export function fixtureCleanup(id:string,scope:unknown){return {schema:"osa.workspace_cleanup.v1" as const,workspace_id:id,scope_sha256:digest(scope??null),state:"REMOVED" as const,confirmed:true,method:"DOCKER_REMOVE" as const};}
