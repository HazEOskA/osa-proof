"use strict";
// Real local API + existing worker host + real dashboard. No network replacement,
// LLM fixtures or synthetic tool responses are used by unified executions.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const {ApiState,handleApiRequest}=require("../dist/apps/api/src/index.js");
const {createDevExecution}=require("../dist/apps/api/src/server.js");
const {createWorkerServer}=require("../dist/apps/worker/src/index.js");
const {DockerWorkspaceProvider}=require("../dist/packages/workspace-runtime/src/index.js");
const token="LOCAL_READONLY_E2E_WORKER_TOKEN_1234567890";
const apiPort=Number(process.env.OSA_E2E_API_PORT||3100);
if(!Number.isInteger(apiPort)||apiPort<1024||apiPort>65535)throw Error("Invalid E2E API port");
process.env.OSA_UNIFIED_ORIGIN="http://127.0.0.1:"+apiPort;
process.env.OSA_WORKER_BASE_URL="http://127.0.0.1:3102";
process.env.OSA_WORKER_TOKEN=token;
const worker=createWorkerServer({token,provider:new DockerWorkspaceProvider()});
worker.listen(3102,"127.0.0.1");
const execution=createDevExecution({...process.env,OSA_EXECUTION_MODE:"fixture"});
// Exercise the real API with the same open-access policy as Vercel Preview.
const state=new ApiState(undefined,undefined,undefined,"open",undefined,undefined,undefined,
  {...process.env,VERCEL:"1",VERCEL_ENV:"preview",OSA_AUTH_MODE:"open"});
const generated=path.resolve(__dirname,"../dashboard-dist");
const root=fs.existsSync(path.join(generated,"index.html"))?generated:path.resolve(__dirname,"../dashboard-src/dist");
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".webp":"image/webp"};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1:"+apiPort);
  if(url.pathname.startsWith("/api/")){
    req.url=url.pathname.slice(4)+url.search;
    void handleApiRequest(req,res,execution.registry,state,execution.description);return;
  }
  const file=path.resolve(root,"."+(url.pathname==="/"?"/index.html":url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,body)=>{res.writeHead(error?404:200,{"content-type":mime[path.extname(file)]||"application/octet-stream"});res.end(error?"Not found":body);});
});
server.listen(apiPort,"127.0.0.1",()=>console.log(JSON.stringify({ready:true,api:apiPort,worker:3102,network_replacements:0,paid_calls:0})));
process.on("SIGTERM",()=>{server.close();worker.close();});
