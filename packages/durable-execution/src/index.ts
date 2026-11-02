import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type DurableStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type DurableKind = "model" | "artifact";
export type DurableInput = {
  execution_id: string;
  conversation_id: string;
  kind: DurableKind;
  prompt: string;
  agent?: string;
  history?: Array<{role:"user"|"assistant";content:string}>;
  artifact_kind?: "webapp" | "document";
  remember?: boolean;
};
export type DurableScope = {organization_id:string;identity_id:string;project_id:string};
export type DurableJob = {
  schema:"osa.durable_job.v1";
  scope:DurableScope;
  input:DurableInput;
  input_sha256:string;
  status:DurableStatus;
  created_at:string;
  updated_at:string;
  started_at?:string;
  finished_at?:string;
  result?:unknown;
  error_code?:string;
};
export class DurableConflict extends Error {
  constructor(readonly code:string) { super(code); }
}
const ID=/^exec_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONVERSATION=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const AGENTS=new Set(["jeverson","leader","coding","commerce","hermes","security","research","runtime"]);
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function validateDurableInput(raw:unknown):DurableInput {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new DurableConflict("DURABLE_INVALID_INPUT");
  const p=raw as Partial<DurableInput>;
  if(Object.keys(p).some(k=>!["execution_id","conversation_id","kind","prompt","agent","history","artifact_kind","remember"].includes(k)) ||
    typeof p.execution_id!=="string"||!ID.test(p.execution_id)||
    typeof p.conversation_id!=="string"||!CONVERSATION.test(p.conversation_id)||
    !["model","artifact"].includes(p.kind||"")||
    typeof p.prompt!=="string"||!p.prompt.trim()||p.prompt.length>4000||
    p.remember!==undefined&&typeof p.remember!=="boolean"||
    p.remember===true||
    (p.kind==="model"&&(!p.agent||!AGENTS.has(p.agent)))||
    (p.kind==="artifact"&&!["webapp","document"].includes(p.artifact_kind||""))||
    (p.history!==undefined&&(!Array.isArray(p.history)||p.history.length>8||
      p.history.some(m=>!m||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>1800))))
    throw new DurableConflict(p.remember===true?"DURABLE_MEMORY_NOT_SUPPORTED":"DURABLE_INVALID_INPUT");
  return {execution_id:p.execution_id,conversation_id:p.conversation_id,kind:p.kind!,prompt:p.prompt.trim(),
    ...(p.agent?{agent:p.agent}:{}),...(p.history?{history:p.history}:{}),...(p.artifact_kind?{artifact_kind:p.artifact_kind}:{})};
}
function validateScope(s:DurableScope) {
  if(!s||Object.values(s).some(v=>typeof v!=="string"||!v||v.length>200||! /^[a-zA-Z0-9_.:@-]+$/.test(v)))
    throw new DurableConflict("DURABLE_SCOPE_INVALID");
}
const isENOENT=(e:unknown)=>e instanceof Error && "code" in e && e.code==="ENOENT";
const isEEXIST=(e:unknown)=>e instanceof Error && "code" in e && e.code==="EEXIST";
export class FileDurableJobStore {
  readonly root:string;
  constructor(directory:string) {
    if(!directory||!resolve(directory).startsWith("/"))throw new DurableConflict("DURABLE_DIRECTORY_REQUIRED");
    this.root=resolve(directory);
  }
  private filename(scope:DurableScope,executionId:string) {
    validateScope(scope);
    if(!ID.test(executionId))throw new DurableConflict("DURABLE_EXECUTION_ID_INVALID");
    return join(this.root,hash([scope.organization_id,scope.identity_id,scope.project_id,executionId])+".json");
  }
  private async read(file:string):Promise<DurableJob|undefined> {
    try {
      const raw=await readFile(file,"utf8");
      if(raw.length>1024*1024)throw new DurableConflict("DURABLE_RECORD_TOO_LARGE");
      const job=JSON.parse(raw) as DurableJob;
      if(job.schema!=="osa.durable_job.v1"||!ID.test(job.input.execution_id))throw Error("invalid");
      return job;
    }catch(e){if(isENOENT(e))return undefined;throw new DurableConflict("DURABLE_RECORD_UNREADABLE");}
  }
  private async write(file:string,job:DurableJob) {
    const tmp=file+"."+randomUUID()+".tmp";
    const data=JSON.stringify(job);
    if(Buffer.byteLength(data)>1024*1024)throw new DurableConflict("DURABLE_RECORD_TOO_LARGE");
    const f=await open(tmp,"wx",0o600);
    try{await f.writeFile(data);await f.sync();}finally{await f.close();}
    try{await rename(tmp,file);}catch(e){await unlink(tmp).catch(()=>{});throw e;}
  }
  async submit(scope:DurableScope,raw:unknown):Promise<{job:DurableJob;created:boolean}> {
    const input=validateDurableInput(raw);
    const file=this.filename(scope,input.execution_id);
    await mkdir(this.root,{recursive:true,mode:0o700});
    const input_sha256=hash(input);
    const now=new Date().toISOString();
    const job:DurableJob={schema:"osa.durable_job.v1",scope:{...scope},input,input_sha256,status:"QUEUED",created_at:now,updated_at:now};
    let created=false;
    try {
      const f=await open(file,"wx",0o600);
      try {await f.writeFile(JSON.stringify(job));await f.sync();created=true;}finally{await f.close();}
    }catch(e){if(!isEEXIST(e))throw e;}
    if(created)return{job,created:true};
    const old=await this.read(file);
    if(!old)throw new DurableConflict("DURABLE_RECORD_UNCONFIRMED");
    if(old.input_sha256!==input_sha256)throw new DurableConflict("DURABLE_ID_CONFLICT");
    return {job:old,created:false};
  }
  async get(scope:DurableScope,executionId:string) {
    return this.read(this.filename(scope,executionId));
  }
  async queued():Promise<string[]> {
    await mkdir(this.root,{recursive:true,mode:0o700});
    const files=await readdir(this.root);
    return files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>join(this.root,f)).sort();
  }
  async claim(file:string):Promise<DurableJob|undefined> {
    if(!file.startsWith(this.root+"/")||!/^[a-f0-9]{64}\.json$/.test(file.slice(this.root.length+1)))
      throw new DurableConflict("DURABLE_PATH_DENIED");
    try {await mkdir(file+".lock", {mode:0o700});}
    catch(e){if(isEEXIST(e))return undefined;throw e;}
    const job=await this.read(file);
    if(!job||job.status!=="QUEUED") {await this.unlock(file);return undefined;}
    const now=new Date().toISOString();
    job.status="RUNNING";job.started_at=now;job.updated_at=now;
    try {await this.write(file,job);return job;}
    catch(e){await this.unlock(file);throw e;}
  }
  async finish(job:DurableJob,status:"COMPLETED"|"FAILED",result?:unknown,error_code?:string) {
    const file=this.filename(job.scope,job.input.execution_id);
    const current=await this.read(file);
    if(!current||current.status!=="RUNNING"||current.input_sha256!==job.input_sha256)
      throw new DurableConflict("DURABLE_RESULT_FENCE");
    const now=new Date().toISOString();
    await this.write(file,{...current,status,updated_at:now,finished_at:now,...(status==="COMPLETED"?{result}: {error_code:error_code||"DURABLE_EXECUTION_FAILED"})});
    await this.unlock(file);
  }
  private async unlock(file:string){try{const {rmdir}=await import("node:fs/promises");await rmdir(file+".lock");}catch{}}
  async publicStatus(job:DurableJob) {
    const interrupted=job.status==="RUNNING"&&Boolean(job.started_at)&&Date.now()-Date.parse(job.started_at!)>240000;
    return {schema:job.schema,execution_id:job.input.execution_id,conversation_id:job.input.conversation_id,
      kind:job.input.kind,status:interrupted?"UNKNOWN":job.status,created_at:job.created_at,updated_at:job.updated_at,
      ...(interrupted?{error_code:"DURABLE_WORKER_UNCONFIRMED"}:{}),
      ...(job.status==="COMPLETED"?{result:job.result}:{}),
      ...(job.status==="FAILED"?{error_code:job.error_code}:{})};
  }
}
