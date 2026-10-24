"use strict";
// Explicit CI transport double only. Production ChatDelivery never falls back to this generator.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {ApiState,handleApiRequest}=require('../dist/apps/api/src');
const {ChatDelivery}=require('../dist/apps/api/src/chat-delivery');
const {createDevExecution}=require('../dist/apps/api/src/server');
const state=new ApiState(undefined,undefined,undefined,'open');
state.delivery=new ChatDelivery(async request=>{
  await new Promise(r=>setTimeout(r,350));
  const title=request.objective.replace(/[&<>"']/g,'');
  return {content:`<!doctype html><html lang="pl"><meta charset="utf-8"><title>Kontrakt testowy</title><body><h1>${title}</h1><button id="count">Dodaj</button><output id="value">0</output><script>document.getElementById('count').onclick=()=>document.getElementById('value').textContent=Number(document.getElementById('value').textContent)+1</script></body></html>`,evidence:[{kind:'model_artifact_generation',data:{source:'CONTROLLED_TEST_GENERATOR',real_provider:false}}]};
},{});
const execution=createDevExecution({OSA_EXECUTION_MODE:'fixture'}),root=path.resolve(__dirname,'../dashboard-dist');
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/')){req.url=u.pathname.slice(4)+u.search;void handleApiRequest(req,res,execution.registry,state,execution.description);return;}
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(e,b)=>{res.writeHead(e?404:200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(e?'Not found':b);});
});
server.listen(3198,'127.0.0.1',()=>console.log('ready: controlled generator / real OSA Runtime / no provider calls'));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close();});
