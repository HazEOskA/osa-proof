import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { handleScopedDurableRequest } from "../../api/src/durable";
import { durableRoute, remoteDurableConfig, durableScopeDigest } from "../../api/src/durable-remote";

// Dedicated loopback listener: no dashboard cookie, no workspace or memory routes.
export function createDurableBridge(env:NodeJS.ProcessEnv=process.env){
  const cfg=remoteDurableConfig(env);
  if(!cfg||!env.OSA_DURABLE_DIR?.trim()||env.VERCEL==="1")throw Error("DURABLE_BRIDGE_CONFIG_REQUIRED");
  const expected=Buffer.from("Bearer "+cfg.token);
  return createServer({requestTimeout:15000,headersTimeout:10000,keepAliveTimeout:5000},(req,res)=>{
    const send=(status:number,code:string)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify({code}));};
    const actual=Buffer.from(req.headers.authorization||"");
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return send(401,"DURABLE_BRIDGE_UNAUTHORIZED");
    if(req.headers["x-osa-durable-scope"]!==durableScopeDigest(cfg.scope))return send(403,"DURABLE_REMOTE_SCOPE_DENIED");
    res.setHeader("x-osa-durable-bridge","v1");
    if(!durableRoute(req.method,req.url||""))return send(404,"DURABLE_ROUTE_NOT_FOUND");
    void handleScopedDurableRequest(req,res,cfg.scope,env).catch(()=>{if(!res.headersSent)send(503,"DURABLE_BRIDGE_UNAVAILABLE");else res.destroy();});
  });
}
if(require.main===module){
  const port=Number(process.env.OSA_DURABLE_BRIDGE_PORT||"8791");
  if(!Number.isInteger(port)||port<1||port>65535)throw Error("INVALID_PORT");
  createDurableBridge().listen(port,"127.0.0.1",()=>console.log("Durable bridge: loopback ready"));
}
