import { createPrivateKey, randomUUID, sign } from "node:crypto";
import type { MissionRecord } from "../../../packages/contracts/src";
import { digest } from "../../../packages/proof-core/src";
import { MissionConflictError, type MissionStore } from "../../../packages/runtime/src/mission-store";

type Env=Record<string,string|undefined>;
export interface StoredRecord<T=unknown>{record_id:string;revision:number;payload:T}
export class StorageError extends Error {
  constructor(readonly code:string,readonly status=503){super(code);}
}
export function durableConfigured(env:Env){return Boolean(env.OSA_STORAGE_URL&&env.OSA_STORAGE_PRIVATE_KEY_B64);}
// A narrow signed transport to the private Postgres store. The signing credential
// and encryption key are server environment variables; neither is returned to UI.
export class DurableStore {
  constructor(private readonly env:Env=process.env,private readonly fetcher:typeof fetch=fetch){}
  private async request<T>(input:Record<string,unknown>):Promise<T>{
    let url:URL,key;
    try{
      url=new URL(this.env.OSA_STORAGE_URL||"");
      if(url.protocol!=="https:"||!url.hostname.endsWith(".supabase.co")||url.username||url.password||url.port||url.search||url.hash||url.pathname!=="/functions/v1/osa-proof-storage")throw Error();
      key=createPrivateKey({key:Buffer.from(this.env.OSA_STORAGE_PRIVATE_KEY_B64||"","base64"),format:"der",type:"pkcs8"});
      if(key.asymmetricKeyType!=="ed25519")throw Error();
    }catch{throw new StorageError("STORAGE_NOT_CONFIGURED");}
    const body=JSON.stringify({...input,namespace:this.env.OSA_STORAGE_NAMESPACE||this.env.VERCEL_ENV||"local",issued_at:Date.now(),nonce:randomUUID()});
    if(Buffer.byteLength(body)>512000)throw new StorageError("STORAGE_RECORD_TOO_LARGE",413);
    const signature=sign(null,Buffer.from(body),key).toString("base64");
    let r:Response;
    try{r=await this.fetcher(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"content-type":"application/json","x-osa-signature":signature},body});}
    catch{throw new StorageError("STORAGE_UNAVAILABLE");}
    if(r.status===409)throw new StorageError("STORAGE_REVISION_CONFLICT",409);
    if(!r.ok)throw new StorageError("STORAGE_REQUEST_REJECTED");
    const chunks:Uint8Array[]=[];let size=0;const reader=r.body?.getReader();
    if(reader)try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4000000){await reader.cancel();throw new StorageError("STORAGE_RESPONSE_TOO_LARGE");}chunks.push(part.value);}}finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;}catch{throw new StorageError("STORAGE_INVALID_RESPONSE");}
  }
  async get<T>(scope:string,kind:string,id:string){return (await this.request<{record:StoredRecord<T>|null}>({op:"get",scope,kind,record_id:id})).record??undefined;}
  async list<T>(scope:string,kind:string){
    const records:StoredRecord<T>[]=[];let cursor:string|undefined;
    do{
      // Pięć maksymalnych rekordów mieści się w limicie odpowiedzi 4 MB.
      const page=await this.request<{records:StoredRecord<T>[];next_cursor:string|null}>({op:"list",scope,kind,cursor:cursor??null,page_size:5});
      if(!page||!Array.isArray(page.records)||page.records.length>5||!(page.next_cursor===null||typeof page.next_cursor==="string"))throw new StorageError("STORAGE_PAGINATION_INVALID");
      let last=cursor;
      for(const row of page.records){
        if(!row||typeof row.record_id!=="string"||!Number.isInteger(row.revision)||row.revision<1||last!==undefined&&row.record_id<=last)throw new StorageError("STORAGE_PAGINATION_INVALID");
        last=row.record_id;
      }
      if(page.next_cursor!==null&&(!page.records.length||page.next_cursor!==last))throw new StorageError("STORAGE_PAGINATION_INVALID");
      records.push(...page.records);cursor=page.next_cursor??undefined;
    }while(cursor!==undefined);
    return records;
  }
  async put<T>(scope:string,kind:string,id:string,payload:T,expectedRevision?:number){return (await this.request<{record:StoredRecord<T>}>({op:"put",scope,kind,record_id:id,payload,expected_revision:expectedRevision??null})).record;}
  async remove(scope:string,kind:string,id:string,expectedRevision:number){await this.request({op:"delete",scope,kind,record_id:id,expected_revision:expectedRevision});}
}
export class DurableMissionStore implements MissionStore {
  readonly persistence="DURABLE_POSTGRES" as const;
  constructor(private readonly store:DurableStore,private readonly scope:string){}
  async get(id:string){
    const row=await this.store.get<{record:MissionRecord;sha256:string}>(this.scope,"missions",id);
    if(!row)return undefined;
    if(row.payload.record.mission.mission_id!==id||row.payload.record.revision!==row.revision||digest(row.payload.record)!==row.payload.sha256)throw new StorageError("MISSION_STORAGE_INTEGRITY_FAILED");
    return row.payload.record;
  }
  async save(record:MissionRecord,expectedRevision?:number){
    if(record.revision!==(expectedRevision??0)+1)throw new MissionConflictError("mission revision conflict");
    try{await this.store.put(this.scope,"missions",record.mission.mission_id,{record,sha256:digest(record)},expectedRevision);}
    catch(e){if(e instanceof StorageError&&e.status===409)throw new MissionConflictError("mission revision conflict");throw e;}
  }
}
