import assert from 'node:assert/strict';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { ApiState, createApiServer } from '../apps/api/src';
import { validateBuildWorkspace, BuildWorkspace } from '../apps/api/src/build';
import { createDevFixtureRegistry } from '../apps/api/src/server';
const workspace = (): BuildWorkspace => ({ team:{organization_id:'org',project_id:'project',team_id:'build',version:'1',agents:[{agent_id:'builder',role:'Builder',executor_ref:'dev.builder.v1'}],edges:[]},resources:[{id:'prompt',kind:'prompts',name:'Instrukcja',description:'',config:{text:'Zadanie {{cel}}',variables:{cel:'test'}},revisions:[]}] });
test('Build rejects cycles, unknown agents and credential material in revisions',()=>{
 const w=workspace();validateBuildWorkspace(w);
 w.team.edges.push({edge_id:'cycle',kind:'handoff',from_agent_id:'builder',to_agent_id:'builder'});assert.throws(()=>validateBuildWorkspace(w));
 const secret=workspace();secret.resources[0].revisions.push({version:1,config:{token:'secret'}});assert.throws(()=>validateBuildWorkspace(secret),/credential_ref/);
 const connection=workspace();connection.resources=[{id:'mcp',kind:'connections',name:'MCP',description:'',config:{protocol:'MCP',endpoint:'https://example.com/mcp?token=secret'},revisions:[]}];assert.throws(()=>validateBuildWorkspace(connection));
});
test('Build config roundtrip and mission to canonical receipt in fixture mode',async()=>{
 // The preview dashboard runs with OSA_AUTH_MODE=open (vercel.json); session mode is covered in auth-mode.test.ts.
 const state=new ApiState(undefined,undefined,undefined,'open');const server=createApiServer(createDevFixtureRegistry(),state,{mode:'fixture'});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/build/workspace')).status,404);
  const w=workspace();const saved=await post('/build/workspace',w);assert.equal(saved.status,201);assert.equal((await saved.json()).persistence,'PROCESS_MEMORY');
  assert.deepEqual(await (await fetch(base+'/build/workspace')).json(),w);
  const status=await (await fetch(base+'/build/status')).json();assert.equal(status.mode,'fixture');assert.equal(status.protocols.MCP,'UNSUPPORTED');
  const mission={organization_id:'org',project_id:'project',team_id:'build',team_version:'1',mission_id:'build-test',entry_agent_id:'builder',objective:'Sprawdź fixture',input:{capability:'AGENT_TASK'},requirements:[{requirement_id:'artifact',type:'evidence_field_equals',evidence_kind:'artifact',field:'status',expected:'built'}]};
  assert.equal((await post('/missions',mission)).status,201);
  const response=await post('/missions/build-test/run',{});assert.equal(response.status,201);const result=await response.json();assert.equal(result.verdict,'VERIFIED');assert.equal(result.proof.schema,'osa.proof_receipt.v2');assert.ok(result.evidence.length);assert.ok(result.events.some((e:{type:string})=>e.type==='RUN_VERIFIED'));
  assert.deepEqual(await (await fetch(base+`/runs/${result.run_id}/proof`)).json(),result.proof);
  const invalid=workspace();invalid.resources[0].config.api_key='secret';assert.equal((await post('/build/workspace',invalid)).status,400);assert.deepEqual(await (await fetch(base+'/build/workspace')).json(),w);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
