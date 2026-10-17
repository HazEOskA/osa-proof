"use strict";
// Rzeczywisty Postgres przez podpisany adapter. Bez wywołania modelu i mocków.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,randomBytes,sign,createPrivateKey}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {DurableStore,DurableMissionStore}=require('../dist/apps/api/src/durable-store');
const {ApiState,createApiServer}=require('../dist/apps/api/src');
const {ProviderVault}=require('../dist/apps/api/src/provider-vault');
const {ExecutorRegistry,MissionKernel}=require('../dist/packages/runtime/src');
const {installUnifiedTools}=require('../dist/apps/api/src/unified');
const {verifyCompletedMission}=require('../dist/packages/proof-core/src');
const {verifyUnifiedBundle}=require('../dist/apps/api/src/unified');
const env={...process.env};
const out=path.resolve('artifacts/finalization-three');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const store=new DurableStore(env),scope='check:'+randomUUID(),key='cas_'+randomUUID();const report={real_postgres:true,network_replacements:0,model_calls:0};
 const created=await store.put(scope,'executions',key,{value:'initial'});assert.equal(created.revision,1);
 const results=await Promise.allSettled(['a','b'].map(value=>new DurableStore(env).put(scope,'executions',key,{value},1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='STORAGE_REVISION_CONFLICT').length,1);
 const fresh=await new DurableStore(env).get(scope,'executions',key);assert.equal(fresh.revision,2);report.concurrent_cas='PASS';await store.remove(scope,'executions',key,2);
 const owner=randomBytes(32).toString('hex'),canary=randomBytes(32).toString('hex'),vault=new ProviderVault(env);
 await vault.put(scope,owner,{provider:'openrouter',model:'openrouter/free',apiKey:canary,allowPaid:false});
 assert.ok((await new ProviderVault(env).get(scope,owner,'openrouter')).apiKey===canary);assert.equal(await new ProviderVault(env).get(scope,randomBytes(32).toString('hex'),'openrouter'),undefined);
 assert.ok(!JSON.stringify(await store.list(scope,'provider_connections')).includes(canary));await vault.remove(scope,owner,'openrouter');report.encrypted_key_new_instance='PASS';report.foreign_owner_denied='PASS';
 const registry=new ExecutorRegistry();installUnifiedTools(registry,env);const missionId='persistence_'+randomUUID();
 const team={organization_id:'org_dev_local',project_id:'osa-proof',team_id:'persistence-team',version:'1',agents:[{agent_id:'native',role:'Kontrola trwałości',executor_ref:'osa.crypto.sha256.v1'}],edges:[]};
 const mission={organization_id:team.organization_id,project_id:team.project_id,team_id:team.team_id,team_version:team.version,mission_id:missionId,objective:'Kontrola trwałości misji',entry_agent_id:'native',input:{message:'Oblicz SHA-256 tekstu: OSA persistence'},requirements:[{requirement_id:'native_ok',type:'evidence_field_equals',evidence_kind:'unified_tool_result',field:'status',expected:'OK',agent_id:'native'}]};
 const kernel=new MissionKernel(new DurableMissionStore(store,scope));await kernel.create(mission,team);await kernel.execute(missionId,registry);
 const restoredMission=await new MissionKernel(new DurableMissionStore(new DurableStore(env),scope)).get(missionId);verifyCompletedMission(restoredMission);report.mission_kernel_new_instance='PASS';report.persisted_mission_execution_id=restoredMission.run.execution_id;fs.writeFileSync(path.join(out,'durable-mission.json'),JSON.stringify(restoredMission,null,2));await store.remove(scope,'missions',missionId,restoredMission.revision);
 const source=JSON.parse(fs.readFileSync(path.join(out,'nvidia-preview-attempt-1.json')));const bundle=source.response.bundle;assert.equal(verifyUnifiedBundle(bundle).ok,true);
 const state=new ApiState(undefined,undefined,undefined,'open',undefined,undefined,undefined,env);await state.rememberExecution(bundle);
 const child=spawnSync(process.execPath,['-e',`const {ApiState}=require('./dist/apps/api/src');(async()=>{const s=new ApiState(undefined,undefined,undefined,'open',undefined,undefined,undefined,process.env);const b=await s.execution('org_dev_local','osa-proof',${JSON.stringify(bundle.execution_id)});if(!b||!require('./dist/apps/api/src/unified').verifyUnifiedBundle(b).ok)process.exit(1);console.log(JSON.stringify({execution_id:b.execution_id,proof_id:b.run.proof.proof_id}));})().catch(()=>process.exit(1));`],{cwd:process.cwd(),env,encoding:'utf8',timeout:30000});assert.equal(child.status,0,'Nowy proces musi odczytać i zweryfikować rzeczywisty dowód');report.new_process_read=JSON.parse(child.stdout);report.provider_response_id=source.response.provider_response_id;
 const bad=structuredClone(bundle);bad.run.evidence[0].data.status='TAMPERED';assert.equal(verifyUnifiedBundle(bad).ok,false);report.tampered_proof_rejected=true;
 const server=createApiServer(new ExecutorRegistry(),new ApiState(undefined,undefined,undefined,'open',undefined,undefined,undefined,env));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const url='http://127.0.0.1:'+server.address().port+'/unified/executions/'+bundle.execution_id;const r=await fetch(url);assert.equal(r.status,200);const b=await r.json();assert.equal(b.persistence,'DURABLE_POSTGRES');assert.equal(verifyUnifiedBundle(b).ok,true);report.new_api_instance_read='PASS';}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 const unsigned=await fetch(env.OSA_STORAGE_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'list',namespace:env.OSA_STORAGE_NAMESPACE,scope:'org_dev_local:osa-proof',kind:'provider_connections'})});assert.equal(unsigned.status,403);report.unsigned_storage_denied=true;
 const crossBody=JSON.stringify({op:'list',namespace:'production-v0.1.0',scope:'org_dev_local:osa-proof',kind:'executions',issued_at:Date.now(),nonce:randomUUID()});const signature=sign(null,Buffer.from(crossBody),createPrivateKey({key:Buffer.from(env.OSA_STORAGE_PRIVATE_KEY_B64,'base64'),format:'der',type:'pkcs8'})).toString('base64');const cross=await fetch(env.OSA_STORAGE_URL,{method:'POST',headers:{'content-type':'application/json','x-osa-signature':signature},body:crossBody});assert.equal(cross.status,403);report.preview_signer_cannot_access_production=true;
 fs.writeFileSync(path.join(out,'durable-live-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(JSON.stringify({status:'FAIL',code:e.code||e.name,message:e.message?.startsWith('STORAGE_')?e.message:'Kontrola trwałego backendu nie przeszła.'}));process.exitCode=1;});
