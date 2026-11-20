import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type DurableStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "CANCELLED";
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
// Generated once per process, not supplied by the client or inferred from a
// generic heartbeat. It identifies the process that actually claimed a job.
const PROCESS_WORKER_ID=`worker_${randomUUID()}`;
export type DurableLease = {token:string;generation:number;expires_at:string;worker_id?:string;protocol?:"transition-v1"};
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
  // Optional for backwards-compatible reads of pre-fencing records. A legacy
  // RUNNING record cannot be adopted by a new worker without proof of outcome.
  lease?:DurableLease;
};
export class DurableConflict extends Error {
  constructor(readonly code:string) { super(code); }
}
const ID=/^exec_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONVERSATION=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LEASE_MS=240000;
const AGENTS=new Set(["jarvis","jeverson","leader","coding","commerce","hermes","security","research","runtime"]);
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
    if(!directory?.trim())throw new DurableConflict("DURABLE_DIRECTORY_REQUIRED");
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
      if(job.lease && (typeof job.lease.token!=="string"||!job.lease.token||
        !Number.isSafeInteger(job.lease.generation)||job.lease.generation<1||
        !Number.isFinite(Date.parse(job.lease.expires_at))||
        (job.lease.worker_id!==undefined&&!/^worker_[a-f0-9-]{36}$/i.test(job.lease.worker_id))))throw Error("invalid lease");
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
  // Read-only discovery for API publication fencing; never accepts a model's
  // success claim as authority over the durable job result.
  async listRecords():Promise<DurableJob[]> {
    let names:string[];
    try {names=await readdir(this.root);}catch(e){if(isENOENT(e))return [];throw e;}
    const jobs:DurableJob[]=[];
    for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
      const job=await this.read(join(this.root,name));
      if(!job)throw new DurableConflict("DURABLE_RECORD_UNCONFIRMED");
      jobs.push(job);
    }
    return jobs;
  }
  // The claim directory is also understood by legacy workers. Cancellation
  // never interrupts a running provider and never removes the durable record.
  async cancelQueued(scope:DurableScope,executionId:string):Promise<DurableJob> {
    const file=this.filename(scope,executionId);
    try {await mkdir(file+".lock",{mode:0o700});}
    catch(e){
      if(isEEXIST(e))throw new DurableConflict("DURABLE_CANCEL_BUSY");
      if(isENOENT(e))throw new DurableConflict("DURABLE_JOB_NOT_FOUND");
      throw e;
    }
    try {
      const current=await this.read(file);
      if(!current)throw new DurableConflict("DURABLE_JOB_NOT_FOUND");
      if(current.status==="CANCELLED")return current;
      if(current.status!=="QUEUED")throw new DurableConflict("DURABLE_CANCEL_UNCONFIRMED");
      const now=new Date().toISOString();
      const cancelled:DurableJob={...current,status:"CANCELLED",updated_at:now,finished_at:now};
      await this.write(file,cancelled);
      return cancelled;
    } finally {await this.unlock(file);}
  }
  async workerHeartbeat():Promise<void> {
    await mkdir(this.root,{recursive:true,mode:0o700});
    const path=join(this.root,"worker-heartbeat");
    const f=await open(path,"w",0o600);
    try{await f.writeFile(String(Date.now()));await f.sync();}finally{await f.close();}
  }
  async workerHealthy():Promise<boolean> {
    try{
      const value=Number(await readFile(join(this.root,"worker-heartbeat"),"utf8"));
      return Number.isFinite(value)&&value<=Date.now()+1000&&Date.now()-value<10000;
    }catch{return false;}
  }
  // The claim lock remains held through RUNNING. A separate short-lived lock
  // serializes read/check/write across processes. A crash leaves the lock in
  // place; it is never stolen automatically, so recovery is fail-closed.
  private async transition<T>(file:string, fn:()=>Promise<T>):Promise<T> {
    const lock=file+".transition.lock";
    try {await mkdir(lock,{mode:0o700});}
    catch(e){if(isEEXIST(e))throw new DurableConflict("DURABLE_TRANSITION_BUSY");throw e;}
    try{return await fn();}
    finally {const {rmdir}=await import("node:fs/promises");await rmdir(lock);}
  }
  private assertLease(current:DurableJob|undefined,claimed:DurableJob,code:string):asserts current is DurableJob {
    if(!current||current.status!=="RUNNING"||current.input_sha256!==claimed.input_sha256||
      !current.lease||!claimed.lease||current.lease.token!==claimed.lease.token||
      current.lease.generation!==claimed.lease.generation||current.lease.worker_id!==claimed.lease.worker_id||
      Date.parse(current.lease.expires_at)<=Date.now())
      throw new DurableConflict(code);
  }
  async touch(job:DurableJob):Promise<void> {
    const file=this.filename(job.scope,job.input.execution_id);
    await this.transition(file,async()=>{
      const current=await this.read(file);
      this.assertLease(current,job,"DURABLE_HEARTBEAT_FENCE");
      const now=Date.now();
      await this.write(file,{...current,updated_at:new Date(now).toISOString(),
        lease:{...current.lease!,expires_at:new Date(now+LEASE_MS).toISOString()}});
    });
  }
  async queued():Promise<string[]> {
    await mkdir(this.root,{recursive:true,mode:0o700});
    const files=await readdir(this.root);
    return files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>join(this.root,f)).sort();
  }
  async claim(file:string):Promise<DurableJob|undefined> {
    if(dirname(file)!==this.root||!/^[a-f0-9]{64}\.json$/.test(basename(file)))
      throw new DurableConflict("DURABLE_PATH_DENIED");
    try {await mkdir(file+".lock", {mode:0o700});}
    catch(e){if(isEEXIST(e))return undefined;throw e;}
    try {
      const job=await this.read(file);
      if(!job||job.status!=="QUEUED") {await this.unlock(file);return undefined;}
      const now=Date.now();
      const generation=(job.lease?.generation??0)+1;
      if(!Number.isSafeInteger(generation))throw new DurableConflict("DURABLE_LEASE_GENERATION_INVALID");
      job.status="RUNNING";job.started_at=new Date(now).toISOString();job.updated_at=job.started_at;
      job.lease={token:randomUUID(),generation,expires_at:new Date(now+LEASE_MS).toISOString(),worker_id:PROCESS_WORKER_ID,protocol:"transition-v1"};
      await this.write(file,job);return job;
    }
    catch(e){await this.unlock(file);throw e;}
  }
  async finish(job:DurableJob,status:"COMPLETED"|"FAILED",result?:unknown,error_code?:string) {
    const file=this.filename(job.scope,job.input.execution_id);
    await this.transition(file,async()=>{
      const current=await this.read(file);
      this.assertLease(current,job,"DURABLE_RESULT_FENCE");
      const now=new Date().toISOString();
      await this.write(file,{...current,status,updated_at:now,finished_at:now,...(status==="COMPLETED"?{result}: {error_code:error_code||"DURABLE_EXECUTION_FAILED"})});
    });
    await this.unlock(file);
  }
  // The provider may have performed an effect even when no response arrived.
  // Do not release the claim or allow a retry without evidence/operator review.
  async markUnknown(job:DurableJob,error_code="DURABLE_EXECUTION_UNCONFIRMED") {
    const file=this.filename(job.scope,job.input.execution_id);
    await this.transition(file,async()=>{
      const current=await this.read(file);
      this.assertLease(current,job,"DURABLE_RESULT_FENCE");
      await this.write(file,{...current,status:"UNKNOWN",updated_at:new Date().toISOString(),error_code});
    });
  }
  private async unlock(file:string){try{const {rmdir}=await import("node:fs/promises");await rmdir(file+".lock");}catch{}}
  async publicStatus(job:DurableJob) {
    // Only claims made by the transition protocol cooperate with this lock.
    // Legacy running jobs are not migrated while old workers may be active.
    let observedAt=Date.now();
    if(job.status==="RUNNING" && job.lease?.protocol==="transition-v1") {
      const file=this.filename(job.scope,job.input.execution_id);
      const current=await this.read(file);
      if(!current)throw new DurableConflict("DURABLE_RECORD_UNCONFIRMED");
      job=current;
      observedAt=Date.now();
      if(current.status==="RUNNING" && current.lease?.protocol==="transition-v1" &&
         Date.parse(current.lease.expires_at)<=observedAt) {
        job=await this.transition(file,async()=>{
          const latest=await this.read(file);
          if(!latest)throw new DurableConflict("DURABLE_RECORD_UNCONFIRMED");
          observedAt=Date.now();
          if(latest.status!=="RUNNING" || latest.lease?.protocol!=="transition-v1" ||
             Date.parse(latest.lease.expires_at)>observedAt)return latest;
          const unknown:DurableJob={...latest,status:"UNKNOWN",updated_at:new Date(observedAt).toISOString(),
            error_code:"DURABLE_WORKER_UNCONFIRMED"};
          await this.write(file,unknown);
          return unknown;
        });
      }
    }
    const deadline=job.lease?Date.parse(job.lease.expires_at):Date.parse(job.updated_at)+LEASE_MS;
    const interrupted=job.status==="RUNNING"&&(!Number.isFinite(deadline)||observedAt>=deadline);
    return {schema:job.schema,execution_id:job.input.execution_id,conversation_id:job.input.conversation_id,
      kind:job.input.kind,status:interrupted?"UNKNOWN":job.status,created_at:job.created_at,updated_at:job.updated_at,
      ...(job.lease?{lease:{generation:job.lease.generation,expires_at:job.lease.expires_at,
        worker_id:job.lease.worker_id??null}}:{}),
      ...(interrupted?{error_code:"DURABLE_WORKER_UNCONFIRMED"}:{}),
      ...(job.status==="COMPLETED"?{result:job.result}:{}),
      ...(job.status==="FAILED"||job.status==="UNKNOWN"?{error_code:job.error_code}:{})};
  }
}
