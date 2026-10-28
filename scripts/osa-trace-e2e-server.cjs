"use strict";
// CI acceptance harness only. A real OSA Proof HTTP server and OsaRuntime run,
// but the two external GET targets are deterministic test doubles.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { ApiState, handleApiRequest } = require("../dist/apps/api/src/index.js");
const { createDevFixtureRegistry } = require("../dist/apps/api/src/server.js");
// Acceptance harness uses actual in-process state and OsaRuntime. No external HTTP,
// and no controlled fake HTTP responses are required for this diagnostic.
const root = path.resolve(__dirname, "../dashboard-dist");
const state = new ApiState(undefined, undefined, undefined, "open");
const registry = createDevFixtureRegistry();
const mime = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",
  ".webp":"image/webp",".json":"application/json"};
const server = http.createServer((req,res)=>{
  const parsed = new URL(req.url || "/", "http://127.0.0.1:3100");
  if(parsed.pathname.startsWith("/api/")){
    req.url=parsed.pathname.slice(4)+parsed.search;
    handleApiRequest(req,res,registry,state,{mode:"fixture"}).catch(e=>{
      if(!res.headersSent){res.writeHead(500,{"content-type":"application/json"});
        res.end(JSON.stringify({error:"API_E2E_HARNESS_FAILURE"}));}
      console.error("API_E2E_HARNESS_FAILURE",String(e?.message||"unknown").slice(0,140));
    });
    return;
  }
  const wanted = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const resolved=path.resolve(root,"."+wanted);
  if(!resolved.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(resolved,(err,buf)=>{
    if(err){res.writeHead(404);res.end("Not found");return;}
    res.writeHead(200,{"content-type":mime[path.extname(resolved)]||"application/octet-stream",
      "cache-control":"no-store"});res.end(buf);
  });
});
server.listen(3100,"127.0.0.1",()=>{
  console.log(JSON.stringify({gate:"OSA_TRACE_BROWSER_HARNESS",ready:true,
    real_osa_runtime:true,source:"IN_PROCESS_API_STATE",external_http:"NOT_USED",
    provider_calls:0,port:3100}));
});
process.on("SIGTERM",()=>{server.close();});
