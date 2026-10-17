import { createHash } from "node:crypto";
import { protectedRuntime, openVercelAccess } from "./operator-access";
type Env = Record<string,string|undefined>;
export class ModelQuotaError extends Error {
  constructor(readonly status:number, readonly code:string, message:string){super(message);}
}
// Two sliding windows in one atomic Redis script. Redis TIME avoids instance clock skew.
// Both limits are checked before insertion; two independent serverless instances share the same key.
export const MODEL_QUOTA_LUA = `
local now = redis.call('TIME')
local ms = tonumber(now[1])*1000 + math.floor(tonumber(now[2])/1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ms-3600000)
if redis.call('ZCARD', KEYS[1]) >= 30 or redis.call('ZCOUNT', KEYS[1], '('..(ms-60000), '+inf') >= 3 then return 0 end
redis.call('ZADD', KEYS[1], ms, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 3600000)
return 1`;
export function sharedQuotaConfigured(env:Env):boolean {
  try {
    const url=new URL(env.OSA_QUOTA_REDIS_REST_URL||"");
    return url.protocol==="https:"&&!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash&&Boolean(env.OSA_QUOTA_REDIS_REST_TOKEN?.trim());
  }catch{return false;}
}
const localWindows=new Map<string,number[]>();
export async function takeModelQuota(env:Env,requestId:string,fetcher:typeof fetch=fetch):Promise<void>{
  if(sharedQuotaConfigured(env) || (protectedRuntime(env) && !openVercelAccess(env))){
    if(!sharedQuotaConfigured(env))throw new ModelQuotaError(503,"SHARED_QUOTA_NOT_CONFIGURED","Model jest zablokowany: brakuje współdzielonego limitu żądań.");
    const scope=[env.VERCEL_ENV||env.NODE_ENV||"protected",env.OSA_OPERATOR_ORGANIZATION_ID,env.OSA_OPERATOR_PROJECT_ID].join(":");
    const key="osa:model-quota:v1:"+createHash("sha256").update(scope).digest("hex");
    try{
      const response=await fetcher(env.OSA_QUOTA_REDIS_REST_URL!,{method:"POST",redirect:"error",signal:AbortSignal.timeout(3000),
        headers:{authorization:"Bearer "+env.OSA_QUOTA_REDIS_REST_TOKEN!,"content-type":"application/json"},
        body:JSON.stringify(["EVAL",MODEL_QUOTA_LUA,"1",key,requestId])});
      if(!response.ok)throw Error("QUOTA_UNAVAILABLE");
      const raw=await response.text();if(raw.length>1024)throw Error("QUOTA_INVALID_RESPONSE");
      const value=JSON.parse(raw) as {result?:unknown;error?:unknown};
      if(value.error || ![0,1].includes(value.result as number))throw Error("QUOTA_INVALID_RESPONSE");
      if(value.result===0)throw new ModelQuotaError(429,"MODEL_RATE_LIMIT","Limit modelu: 3 żądania na minutę i 30 na godzinę dla projektu.");
      return;
    }catch(error){if(error instanceof ModelQuotaError)throw error;throw new ModelQuotaError(503,"SHARED_QUOTA_UNAVAILABLE","Model jest zablokowany: współdzielony licznik nie odpowiada.");}
  }
  const key=createHash("sha256").update(env.OSA_MODEL_QUOTA_SCOPE||env.NVIDIA_API_KEY||"default").digest("hex");
  const calls=localWindows.get(key)??[];localWindows.set(key,calls);
  const now=Date.now();while(calls[0]!==undefined&&now-calls[0]>=3600000)calls.shift();
  if(calls.length>=30||calls.filter(t=>now-t<60000).length>=3)throw new ModelQuotaError(429,"MODEL_RATE_LIMIT","Lokalny limit modelu: 3 żądania na minutę i 30 na godzinę.");
  calls.push(now);
}
