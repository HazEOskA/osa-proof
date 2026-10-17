"use strict";
// Local static UI contracts only. Provider responses are explicitly simulated by each test.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),{spawn}=require("node:child_process");
const root=path.resolve(__dirname,"../dashboard-dist");
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".svg":"image/svg+xml",".woff2":"font/woff2"};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1");const file=path.resolve(root,"."+(url.pathname==="/"?"/index.html":url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{"content-type":mime[path.extname(file)]||"application/octet-stream"});res.end(e?"Not found":data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 for(const script of ["scripts/test-jeverson-mobile-layout.mjs","scripts/test-osa-guide-browser.mjs","scripts/test-operator-ui.mjs","scripts/test-api-connections-browser.mjs"]){
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script],{stdio:"inherit",env:{...process.env,OSA_UI_TEST_BASE:"http://127.0.0.1:"+server.address().port}});child.on("exit",code=>code===0?resolve():reject(Error(script+" failed: "+code)));child.on("error",reject);});
 }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server.closeAllConnections();server.close();});
