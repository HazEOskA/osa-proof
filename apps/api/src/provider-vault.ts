import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, link } from "node:fs/promises";
import { resolve, join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { protectedRuntime } from "./operator-access";
import { DurableStore, durableConfigured } from "./durable-store";

export const PROVIDER_IDS=["nvidia","openrouter","openai","anthropic","compatible"] as const;
export type ChatProvider = typeof PROVIDER_IDS[number];
export interface ProviderConnection {provider:ChatProvider;model:string;apiKey:string;baseUrl?:string;allowPaid:boolean}
export class ConnectionError extends Error {constructor(readonly status:number,readonly code:string,message:string){super(message);}}
type Env=Record<string,string|undefined>;
const COMPATIBLE_HOSTS=new Set(["api.groq.com","api.mistral.ai","api.deepseek.com","api.x.ai","api.together.xyz","api.fireworks.ai","router.huggingface.co","generativelanguage.googleapis.com","api.cohere.ai"]);
const sessionKey=randomBytes(32);
const sessionConnections=new Map<string,{ciphertext:string;expiresAt:number}>();
export function validateConnection(value:unknown):ProviderConnection {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ConnectionError(400,"INVALID_CONNECTION","Nieprawidłowe połączenie API.");
  const v=value as Record<string,unknown>;
  if(!PROVIDER_IDS.includes(v.provider as ChatProvider)||typeof v.apiKey!=="string"||!/^[A-Za-z0-9_.:-]{10,4096}$/.test(v.apiKey.trim())||typeof v.model!=="string"||!v.model.trim()||v.model.length>200||!/^[A-Za-z0-9_./:@-]+$/.test(v.model))throw new ConnectionError(400,"INVALID_CONNECTION","Wybierz dostawcę, podaj klucz API i identyfikator modelu.");
  if(v.allowPaid!==undefined&&typeof v.allowPaid!=="boolean")throw new ConnectionError(400,"INVALID_COST_CONSENT","Nieprawidłowa zgoda na rozliczenie dostawcy.");
  let baseUrl:string|undefined;
  if(v.provider==="compatible") {
    try{const url=new URL(String(v.baseUrl));if(url.protocol!=="https:"||url.username||url.password||url.port||url.search||url.hash||!COMPATIBLE_HOSTS.has(url.hostname))throw Error();baseUrl=url.origin+url.pathname.replace(/\/+$/,"");}
    catch{throw new ConnectionError(400,"INVALID_PROVIDER_URL","Podaj adres HTTPS publicznego API: Groq, Mistral, DeepSeek, xAI, Together, Fireworks, Hugging Face, Gemini lub Cohere.");}
  } else if(v.baseUrl!==undefined&&v.baseUrl!=="")throw new ConnectionError(400,"FIXED_PROVIDER_URL","Wybrany dostawca ma stały adres API.");
  return {provider:v.provider as ChatProvider,model:v.model.trim(),apiKey:v.apiKey.trim(),allowPaid:v.allowPaid===true,...(baseUrl?{baseUrl}:{})};
}

// Each browser owns an opaque HttpOnly cookie. Only its HMAC is used as a row key.
// Keys are encrypted before any filesystem/database write; no read API returns a key.
export class ProviderVault {
  private initialized?:Promise<void>;
  constructor(private readonly env:Env=process.env) {}
  mode(){return durableConfigured(this.env)?"DURABLE_SERVER_ENCRYPTED":this.env.OSA_CONNECTIONS_DATABASE_URL?"POSTGRES_ENCRYPTED":protectedRuntime(this.env)?"PROCESS_MEMORY":"LOCAL_ENCRYPTED_FILE";}
  ready(){const supplied=this.env.OSA_CONNECTIONS_ENCRYPTION_KEY;return supplied?/^[a-f0-9]{64}$/i.test(supplied):!this.env.OSA_CONNECTIONS_DATABASE_URL&&!durableConfigured(this.env);}
  ttl(){return this.mode()==="PROCESS_MEMORY"?3600:30*86400;}
  private directory(){return resolve(this.env.OSA_CONNECTIONS_DIR||".osa-proof/connections");}
  private async key():Promise<Buffer>{
    const supplied=this.env.OSA_CONNECTIONS_ENCRYPTION_KEY;
    if(supplied&&/^[a-f0-9]{64}$/i.test(supplied))return Buffer.from(supplied,"hex");
    if(supplied)throw new ConnectionError(503,"CONNECTION_ENCRYPTION_NOT_CONFIGURED","Serwerowy klucz szyfrowania ma nieprawidłową konfigurację.");
    if(this.env.OSA_CONNECTIONS_DATABASE_URL||durableConfigured(this.env))throw new ConnectionError(503,"CONNECTION_STORE_NOT_CONFIGURED","Zapis kluczy wymaga serwerowego klucza szyfrowania.");
    if(protectedRuntime(this.env))return sessionKey;
    const dir=this.directory();await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,".encryption-key");
    const tmp=file+"."+randomBytes(8).toString("hex");
    try{await writeFile(tmp,randomBytes(32).toString("hex"),{flag:"wx",mode:0o600});try{await link(tmp,file);}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}}finally{await rm(tmp,{force:true});}
    return Buffer.from((await readFile(file,"utf8")).trim(),"hex");
  }
  private async owner(scope:string,cookie:string){return createHmac("sha256",await this.key()).update(scope+":"+cookie).digest("hex");}
  private db(){if(!this.env.OSA_CONNECTIONS_DATABASE_URL)throw Error("DATABASE_NOT_CONFIGURED");return neon(this.env.OSA_CONNECTIONS_DATABASE_URL);}
  private async initialize(){
    this.initialized??=this.db().query("CREATE TABLE IF NOT EXISTS osa_provider_connections (owner_id text NOT NULL, provider text NOT NULL, ciphertext text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (owner_id, provider))").then(()=>undefined);
    try{await this.initialized;}catch{this.initialized=undefined;throw new ConnectionError(503,"CONNECTION_STORE_UNAVAILABLE","Serwerowy magazyn połączeń nie odpowiada.");}
  }
  private encrypt(value:ProviderConnection,key:Buffer,owner:string){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(owner+":"+value.provider));const data=Buffer.concat([cipher.update(JSON.stringify({connection:value,expiresAt:Date.now()+this.ttl()*1000}),"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(v=>v.toString("base64url")).join(".");}
  private decrypt(value:string,key:Buffer,owner:string,provider:ChatProvider){const [iv,tag,data,...extra]=value.split(".");if(extra.length||!data)throw Error("INVALID_CIPHERTEXT");const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from(owner+":"+provider));decipher.setAuthTag(Buffer.from(tag,"base64url"));const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8"));if(!Number.isFinite(payload.expiresAt))throw Error("INVALID_EXPIRY");return payload.expiresAt<=Date.now()?undefined:validateConnection(payload.connection);}
  async get(scope:string,cookie:string,provider:ChatProvider):Promise<ProviderConnection|undefined>{
    if(!this.ready())return undefined;
    const key=await this.key(),owner=await this.owner(scope,cookie);let ciphertext:string|undefined;
    if(this.mode()==="DURABLE_SERVER_ENCRYPTED"){const row=await new DurableStore(this.env).get<{ciphertext:string}>(scope,"provider_connections",owner+"-"+provider);ciphertext=row?.payload.ciphertext;}
    else if(this.mode()==="PROCESS_MEMORY"){const entry=sessionConnections.get(owner+":"+provider);if(entry&&entry.expiresAt>Date.now())ciphertext=entry.ciphertext;else sessionConnections.delete(owner+":"+provider);}
    else if(this.env.OSA_CONNECTIONS_DATABASE_URL){await this.initialize();try{const rows=await this.db().query("SELECT ciphertext FROM osa_provider_connections WHERE owner_id=$1 AND provider=$2",[owner,provider]);ciphertext=rows[0]?.ciphertext as string|undefined;}catch{throw new ConnectionError(503,"CONNECTION_STORE_UNAVAILABLE","Serwerowy magazyn połączeń nie odpowiada.");}}
    else{try{ciphertext=await readFile(join(this.directory(),owner+"-"+provider+".enc"),"utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw new ConnectionError(503,"CONNECTION_STORE_UNAVAILABLE","Nie można odczytać zapisanego połączenia.");}}
    if(!ciphertext)return undefined;
    try{return this.decrypt(ciphertext,key,owner,provider);}catch{throw new ConnectionError(503,"CONNECTION_INTEGRITY_FAILED","Zapisane połączenie nie przeszło kontroli integralności.");}
  }
  async put(scope:string,cookie:string,value:ProviderConnection){
    if(!this.ready())throw new ConnectionError(503,"CONNECTION_STORE_NOT_CONFIGURED","Trwały zapis kluczy API wymaga podłączenia serwerowego magazynu. Klucz nie został zapisany.");
    const key=await this.key(),owner=await this.owner(scope,cookie),ciphertext=this.encrypt(value,key,owner);
    if(this.mode()==="DURABLE_SERVER_ENCRYPTED"){
      const store=new DurableStore(this.env),id=owner+"-"+value.provider;
      const current=await store.get(scope,"provider_connections",id);
      await store.put(scope,"provider_connections",id,{ciphertext},current?.revision);
    }
    else if(this.mode()==="PROCESS_MEMORY"){
      for(const [id,entry] of sessionConnections)if(entry.expiresAt<=Date.now())sessionConnections.delete(id);
      const id=owner+":"+value.provider;
      if(!sessionConnections.has(id)&&sessionConnections.size>=500)throw new ConnectionError(503,"CONNECTION_SESSION_LIMIT","Limit tymczasowych połączeń serwera. Spróbuj później.");
      sessionConnections.set(id,{ciphertext,expiresAt:Date.now()+this.ttl()*1000});
    }
    else if(this.env.OSA_CONNECTIONS_DATABASE_URL){await this.initialize();try{await this.db().query("INSERT INTO osa_provider_connections (owner_id,provider,ciphertext) VALUES ($1,$2,$3) ON CONFLICT (owner_id,provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=now()",[owner,value.provider,ciphertext]);}catch{throw new ConnectionError(503,"CONNECTION_STORE_UNAVAILABLE","Serwerowy magazyn połączeń nie zapisał klucza.");}}
    else{const path=join(this.directory(),owner+"-"+value.provider+".enc"),tmp=path+"."+randomBytes(8).toString("hex");try{await writeFile(tmp,ciphertext,{flag:"wx",mode:0o600});await rename(tmp,path);}finally{await rm(tmp,{force:true});}}
  }
  async remove(scope:string,cookie:string,provider:ChatProvider){
    if(!this.ready())throw new ConnectionError(503,"CONNECTION_STORE_NOT_CONFIGURED","Magazyn połączeń nie jest podłączony.");
    const owner=await this.owner(scope,cookie);
    if(this.mode()==="DURABLE_SERVER_ENCRYPTED"){const store=new DurableStore(this.env),id=owner+"-"+provider,current=await store.get(scope,"provider_connections",id);if(current)await store.remove(scope,"provider_connections",id,current.revision);}
    else if(this.mode()==="PROCESS_MEMORY")sessionConnections.delete(owner+":"+provider);
    else if(this.env.OSA_CONNECTIONS_DATABASE_URL){await this.initialize();try{await this.db().query("DELETE FROM osa_provider_connections WHERE owner_id=$1 AND provider=$2",[owner,provider]);}catch{throw new ConnectionError(503,"CONNECTION_STORE_UNAVAILABLE","Serwerowy magazyn połączeń nie odpowiada.");}}
    else await rm(join(this.directory(),owner+"-"+provider+".enc"),{force:true});
  }
}
