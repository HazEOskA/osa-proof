"use strict";
// Local CI only: real HTTP API and independent worker subprocess.
// No provider credentials, no new infrastructure, no Production mutations.
const http=require("node:http"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {spawn}=require("node:child_process");
const {ApiState,handleApiRequest}=require("../dist/apps/api/src");
const {createDevExecution}=require("../dist/apps/api/src/server");
const root=path.resolve(__dirname,"../dashboard-dist");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"osa-durable-browser-"));
process.env.OSA_DURABLE_DIR=dir;process.env.VERCEL="";
const worker=spawn(process.execPath,["scripts/durable-e2e-worker.cjs"],{
  cwd:path.resolve(__dirname,".."),env:{...process.env,OSA_DURABLE_DIR:dir,VERCEL:""},stdio:"inherit"
});
const state=new ApiState(undefined,undefined,undefined,"open");
const runtime=createDevExecution({OSA_EXECUTION_MODE:"fixture"});
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css"};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||"/","http://127.0.0.1:3203");
  if(u.pathname.startsWith("/api/")){
    req.url=u.pathname.slice(4)+u.search;
    handleApiRequest(req,res,runtime.registry,state,runtime.description).catch(()=>{
      if(!res.headersSent){res.writeHead(500);res.end("API_TEST_FAILURE");}
    });
    return;
  }
  const f=path.resolve(root,"."+(u.pathname==="/"?"/index.html":u.pathname));
  if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(f,(e,b)=>{res.writeHead(e?404:200,{"content-type":mime[path.extname(f)]||"application/octet-stream","cache-control":"no-store"});res.end(e?"Not found":b);});
});
server.listen(3203,"127.0.0.1",()=>console.log("DURABLE_TEST_SERVER_READY"));
process.on("SIGTERM",()=>{worker.kill("SIGTERM");server.closeAllConnections();server.close();fs.rmSync(dir,{recursive:true,force:true});});
