import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiState, createApiServer } from '../apps/api/src';
import { createDevFixtureRegistry } from '../apps/api/src/server';
import { MissionKernel, ExecutorRegistry } from '../packages/runtime/src';
import { verifyCompletedMission } from '../packages/proof-core/src';
import { demoTeam, demoMission, installDemoExecutors, demoReport, validateDemoRequest, DemoRequest, DemoOutput } from '../packages/demo-team/src';
const request:DemoRequest={objective:'Create a delivery report',kind:'document',mode:'starter',target:'artifact'};
async function run(changes:Partial<DemoRequest>={}) {
 const registry=createDevFixtureRegistry(),kernel=new MissionKernel(),team=demoTeam({organization_id:'org_demo',project_id:'project_demo'});
 installDemoExecutors(registry,{executionMode:'fixture'});const mission=demoMission({...request,...changes},team);
 await kernel.create(mission,team);await kernel.plan(mission.mission_id,registry);await kernel.execute(mission.mission_id,registry);
 return {record:(await kernel.get(mission.mission_id))!,registry,kernel};
}
test('document traverses ten real runtime agents, brain plan, evidence and completed mission receipts',async()=>{
 const {record,kernel,registry}=await run();verifyCompletedMission(record);assert.equal(record.state,'COMPLETED');
 assert.equal(record.run!.events.filter(e=>e.type==='AGENT_COMPLETED').length,10);
 const report=demoReport(record);assert.equal(report.ready_for_review,true);assert.equal(report.checks.length,10);
 assert.ok(report.artifact?.content.includes('deterministic starter'));assert.ok(report.checks.every(c=>c.evidence_refs.length>0));
 assert.ok(report.coverage.some(c=>c.capability==='Benchmarks'&&c.status==='UNKNOWN'));
 const replay=await kernel.execute(record.mission.mission_id,registry);assert.equal(replay.execution_id,record.run!.execution_id);
});
test('starter webapp escapes input and produces real self-contained source',async()=>{
 const {record}=await run({kind:'webapp',objective:'</h1><script>alert(1)</script>'});
 const html=demoReport(record).artifact!.content;assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.equal((html.match(/<script>/g)||[]).length,1);assert.ok(html.includes("addEventListener('click'"));
 verifyCompletedMission(record);
});
test('model mode never substitutes fixture; unsupported output, missing sandbox and Azure prevent completion',async()=>{
 for(const changes of [{mode:'connected'},{kind:'other'},{target:'sandbox'},{target:'azure'}] as Partial<DemoRequest>[]) {
  const {record}=await run(changes);assert.equal(record.state,'FAILED');assert.equal(record.mission_receipt,undefined);
  assert.equal(demoReport(record).ready_for_review,false);assert.ok(demoReport(record).checks.some(c=>c.status==='BLOCKED'));
 }
});
test('invalid requests reject injected policy, approvals, identifiers and oversized input',()=>{
 for(const value of [null,{}, {...request,objective:''},{...request,objective:'x'.repeat(4001)},{...request,kind:'shell'},{...request,approval:true},{...request,organization_id:'foreign'}]) assert.throws(()=>validateDemoRequest(value));
});
test('tampered artifact or proof cannot remain ready for review',async()=>{
 const {record}=await run();(record.run!.final_output as DemoOutput).artifact!.content='tampered';
 assert.equal(demoReport(record).ready_for_review,false);assert.ok(demoReport(record).coverage.some(c=>c.capability==='Proof'&&c.status==='FAIL'));
});
test('connected mode uses registered planner/builder and reports invalid HTML as failed',async()=>{
 const registry=new ExecutorRegistry();let calls=0;
 registry.register('dev.planner.v1',()=>({output:{plan:{summary:'real plan',steps:['build']}},evidence:[]}));
 registry.register('dev.builder.v1',()=>{calls++;return {output:{artifact:{content:'not html'}},evidence:[]};});
 installDemoExecutors(registry,{executionMode:'provider'});const kernel=new MissionKernel(),team=demoTeam({organization_id:'org_demo',project_id:'project_demo'}),mission=demoMission({...request,kind:'webapp',mode:'connected'},team);
 await kernel.create(mission,team);await kernel.execute(mission.mission_id,registry);const record=(await kernel.get(mission.mission_id))!;
 assert.equal(calls,1);assert.equal(record.state,'FAILED');assert.equal(demoReport(record).checks.find(c=>c.stage==='inspector')?.status,'FAIL');
});
test('sandbox failure cleans up and cannot fabricate a BuildReceipt',async()=>{
 let stopped=0;const registry=createDevFixtureRegistry();installDemoExecutors(registry,{executionMode:'fixture',workspace:{id:'test-mock',create:async()=>({id:'mock',rootDir:'/workspace',writeFile:async()=>{},exec:async()=>({exitCode:1,stdout:'',stderr:'secret-do-not-leak'}),stop:async()=>{stopped++;}})}});
 const kernel=new MissionKernel(),team=demoTeam({organization_id:'org_demo',project_id:'project_demo'}),mission=demoMission({...request,target:'sandbox'},team);
 await kernel.create(mission,team);await kernel.execute(mission.mission_id,registry);const record=(await kernel.get(mission.mission_id))!;
 assert.equal(stopped,1);assert.equal(record.state,'FAILED');assert.equal((record.run!.final_output as DemoOutput).build_receipt,undefined);assert.ok(!JSON.stringify(record).includes('secret-do-not-leak'));
});
test('API requires authentication, protects tenant reads and rejects generic managed-template bypass',async()=>{
 const registry=createDevFixtureRegistry(),state=new ApiState(undefined,undefined,undefined,'session'),server=createApiServer(registry,state,{mode:'fixture'});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try {
  assert.equal((await fetch(base+'/templates/delivery-lab')).status,401);
  const session=state.sessions.create({identity_id:'user',provider:'local-dev',subject:'user',display_name:'User',organization_id:'org_demo',roles:['developer'],verified:true});
  const headers={authorization:`Bearer ${session.token}`,'content-type':'application/json'};
  const response=await fetch(base+'/templates/delivery-lab/runs',{method:'POST',headers,body:JSON.stringify(request)});assert.equal(response.status,201);
  const result=await response.json() as any;assert.equal(result.report.state,'COMPLETED');assert.ok(result.report.mission_receipt);
  const other=state.sessions.create({identity_id:'foreign',provider:'local-dev',subject:'foreign',display_name:'Foreign',organization_id:'org_foreign',roles:['developer'],verified:true});
  for(const route of [`/templates/delivery-lab/missions/${result.report.mission_id}`,`/missions/${result.report.mission_id}`,`/runs/${result.run.run_id}`]) assert.equal((await fetch(base+route,{headers:{authorization:`Bearer ${other.token}`}})).status,403);
  assert.equal((await fetch(base+'/teams',{method:'POST',headers,body:JSON.stringify(result.record.team)})).status,403);
  assert.equal((await fetch(base+'/missions',{method:'POST',headers,body:JSON.stringify({...result.record.mission,mission_id:'forged'})})).status,403);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
