import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDevExecution} from '../apps/api/src/server';
import {executeUnified,unifiedInput,verifyUnifiedBundle} from '../apps/api/src/unified';
import {NativeBuilder,createNativeBuilderExecutor} from '../packages/builder-core/src';
import type {WorkspaceProvider} from '../packages/workspace-runtime/src';

test('explicit model dispatch uses exact arguments, binds provenance and rejects tampering',async()=>{
 const execution_id='exec_'+randomUUID(),selection={provider:'openrouter',model:'unit-test-model',response_sha256:'f'.repeat(64)};
 const runtime=createDevExecution({OSA_EXECUTION_MODE:'fixture'});
 const r=await executeUnified({message:'Digest this text',execution_id,tool:'osa.crypto.sha256.v1',args:{text:'exact data'},selection},'org_dev_local',runtime.registry);
 assert.equal(r.routing,'MODEL_TOOL_CALL');assert.equal(r.status,'EXECUTED');
 assert.equal((r.run.final_output as {text:string}).text,'exact data');
 assert.ok(r.run.evidence.some(e=>e.kind==='model_dispatch'));
 assert.ok(r.run.events.every(e=>e.execution_id===execution_id));
 assert.equal(verifyUnifiedBundle(r).ok,true);
 const tampered=structuredClone(r);tampered.run.evidence[1].data.model='forged';
 assert.equal(verifyUnifiedBundle(tampered).ok,false);
 assert.throws(()=>unifiedInput({message:'text',execution_id,tool:'shell.exec',args:{},selection}));
});
test('builder cannot create workspace without an explicit trusted mutation grant',async()=>{
 let created=0;
 const provider={id:'not-a-runtime',create:async()=>{created++;throw Error('unexpected')}} as unknown as WorkspaceProvider;
 const request={taskId:'test',repoUrl:'https://github.com/HazEOskA/osa-proof',prompt:'task',selectedAgent:'codex' as const,timeoutMs:1000};
 await assert.rejects(()=>new NativeBuilder({workspaceProvider:provider}).run(request),/APPROVAL_REQUIRED/);
 assert.equal(created,0);
});
test('native executor denies unsigned client approval before worker or provider access',async()=>{
 const executor=createNativeBuilderExecutor({env:{}});
 await assert.rejects(async()=>executor({execution_id:'exec_'+randomUUID(),mission:{mission_id:'m',objective:'test',input:{repo_url:'https://github.com/HazEOskA/osa-proof',builder_approval:{approved:true}}}} as never),/APPROVAL_REQUIRED/);
});

test('fresh API instance verifies exported proof and rejects unauthorized model dispatch',async()=>{
 const {ApiState,handleApiRequest}=await import('../apps/api/src');
 const {createServer}=await import('node:http');
 const runtime=createDevExecution({OSA_EXECUTION_MODE:'fixture'});
 const bundle=await executeUnified({message:'Oblicz SHA-256 tekstu: persisted',execution_id:'exec_'+randomUUID()},'org_dev_local',runtime.registry);
 // A fresh state has no record of this run, modelling serverless state loss.
 const fresh=new ApiState(undefined,undefined,undefined,'open');
 const server=createServer((req,res)=>void handleApiRequest(req,res,runtime.registry,fresh,{mode:'fixture'}));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port;
  const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const valid=await post('/unified/verify',bundle);assert.equal((await valid.json() as {ok:boolean}).ok,true);
  const tampered=structuredClone(bundle);tampered.run.final_output={forged:true};
  const invalid=await post('/unified/verify',tampered);assert.equal((await invalid.json() as {ok:boolean}).ok,false);
  const denied=await post('/unified/execute',{message:'attempt',execution_id:'exec_'+randomUUID(),tool:'osa.conversation.record.v1',args:{answer:'invented'},selection:{provider:'nvidia',model:'forged',response_sha256:'a'.repeat(64)}});
  assert.equal(denied.status,403);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
