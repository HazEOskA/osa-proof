// Local-only integration harness: real dashboard/API/NeurOSA, synthetic session,
// fixed test executors. It does not attest sandbox isolation or production auth.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, extname } = require('node:path');
const { chromium } = require('playwright');
const { ApiState, handleApiRequest } = require('../dist/apps/api/src');
const { NeurosaMemoryAdapter } = require('../dist/packages/adapters/src');
const { BrainControlPlane, NativeBrainPlanner } = require('../dist/packages/brain/src');
const { sealMemoryEvent } = require('../dist/packages/brain/src/memory');
const { ExecutorRegistry, FileMissionStore } = require('../dist/packages/runtime/src');
const { verifyCompletedMission } = require('../dist/packages/proof-core/src');
const neurosaDir = process.env.NEUROSA_CHECKOUT;
if (!neurosaDir) throw Error('NEUROSA_CHECKOUT required');
const mobile = process.env.OSA_BROWSER_VIEWPORT === 'mobile';
const root = resolve(__dirname, '..'), dashboard = join(root, 'dashboard-dist');
const token = `synthetic-${randomUUID()}-${randomUUID()}`;
const scope = { organization_id:'synthetic_browser_org', project_id:'synthetic_browser_project', mission_id:'browser-memory-seed' };
const marker = `OSABROWSER${randomUUID().replaceAll('-', '')}`;
const workspace = { team: { organization_id:scope.organization_id, project_id:scope.project_id, team_id:'browser-team', version:'1',
  agents:[{agent_id:'reader1',role:'Odczyt README',executor_ref:'audit.readme'}, {agent_id:'reader2',role:'Odczyt package',executor_ref:'audit.package'}],
  edges:[{edge_id:'handoff',from_agent_id:'reader1',to_agent_id:'reader2',kind:'handoff'}]},resources:[] };
let dir, brain, server, browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function startBrain(){
  let out=''; const child=spawn(process.execPath,['--import','tsx','apps/brain-api/src/server.ts'],{cwd:neurosaDir,env:{...process.env,
    NEUROSA_API_TOKEN:token,NEUROSA_API_SCOPES:'brain:read,memory:read,memory:write',NEUROSA_DATABASE_PATH:join(dir,'brain.db'),NEUROSA_API_PORT:'0',NEUROSA_API_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>out+=v);
  for(let i=0;i<150;i++){const m=out.match(/nasłuchuje: (http:\/\/127\.0\.0\.1:\d+)/);if(m)return {child,base:m[1]};if(child.exitCode!==null)throw Error('brain startup '+out.slice(-500));await sleep(100);}
  child.kill('SIGTERM');throw Error('brain startup timeout');
}
async function closeBrain(){if(brain&&brain.child.exitCode===null){const done=new Promise(r=>brain.child.once('exit',r));brain.child.kill('SIGTERM');await done;}}
function memory(){return new NeurosaMemoryAdapter({baseUrl:brain.base,token,brainId:'OsaBrain',organizationId:scope.organization_id,projectId:scope.project_id});}
async function main(){
  dir=await mkdtemp(join(tmpdir(),'osa-browser-neurosa-'));brain=await startBrain();let adapter=memory();
  const event=sealMemoryEvent({scope,kind:'AUTHENTICATED_USER_STATEMENT',verification_scope:'synthetic_browser_test',data:{text:`${marker} Sprawdź dwa pliki dozwolonego repozytorium`}});
  const memoryReceipt=await adapter.observe(event);
  const registry=new ExecutorRegistry();let executions=0;
  for(const [ref,file] of [['audit.readme','README.md'],['audit.package','package.json']]) registry.register(ref,async({input,mission})=>{
    const expected=['README.md','package.json'];const actual=mission.input;
    if(actual.repository!=='HazEOskA/osa-proof'||JSON.stringify(actual.files)!==JSON.stringify(expected))throw Error('REPOSITORY_SCOPE_DENIED');
    executions++;const content=await readFile(join(root,file));const result={file,read:true,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};
    return {output:{previous:input,result},evidence:[{kind:'repository_read',data:result}]};
  });
  const state=new ApiState(undefined,undefined,undefined,'session',new FileMissionStore(join(dir,'missions')),new BrainControlPlane(new NativeBrainPlanner(),adapter));
  const identity={identity_id:'browser-test',provider:'microsoft',subject:'synthetic-browser',display_name:'synthetic browser',verified:true,roles:[],organization_id:scope.organization_id,project_ids:[scope.project_id]};
  const session=state.sessions.create(identity);
  server=createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname.startsWith('/api/')){req.url=url.pathname.slice(4)+url.search;void handleApiRequest(req,res,registry,state,{mode:'local-test'});return;}
    const p=resolve(dashboard,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!p.startsWith(dashboard+'/')){res.writeHead(403);res.end();return;}
    void readFile(p).then(data=>{const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(p)]||'application/octet-stream';res.writeHead(200,{'content-type':type});res.end(data);},()=>{res.writeHead(404);res.end();});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:900},extraHTTPHeaders:{authorization:`Bearer ${session.token}`},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(ws=>localStorage.setItem('osa.build.workspace.v1',JSON.stringify(ws)),workspace);
  const response=await page.goto(base,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
  if(mobile) await page.getByRole('button',{name:'Otwórz nawigację'}).click();
  const navigation=mobile?page.getByRole('dialog',{name:'Nawigacja'}).getByRole('navigation',{name:'Primary'}):page.getByRole('navigation',{name:'Primary'}).filter({visible:true});
  await navigation.getByRole('button',{name:'Studio',exact:true}).click();
  await page.getByLabel('Cel / Definition of Done').fill(`${marker} Sprawdź dwa pliki dozwolonego repozytorium`);
  await page.getByLabel('Wejście JSON · prompt / task / repo_url / requested_operation').fill(JSON.stringify({repository:'HazEOskA/osa-proof',files:['README.md','package.json']}));
  await page.getByLabel('Kryteria dowodowe JSON · evidence_field_equals').fill(JSON.stringify(['reader1','reader2'].map(agent_id=>({requirement_id:`read-${agent_id}`,type:'evidence_field_equals',agent_id,evidence_kind:'repository_read',field:'read',expected:true}))));
  await page.getByRole('button',{name:'Sprawdź misję',exact:true}).click();
  const runResponse=page.waitForResponse(r=>/\/api\/missions\/[^/]+\/run$/.test(new URL(r.url()).pathname)&&r.request().method()==='POST', {timeout:30000});
  await page.getByRole('button',{name:'Uruchom misję',exact:true}).click();const runHttp=await runResponse;assert.equal(runHttp.status(),201);const run=await runHttp.json();
  await page.getByText(/Wynik verifiera: VERIFIED/).waitFor({timeout:10000});assert.equal(run.verdict,'VERIFIED');assert.equal(executions,2);assert.deepEqual(errors,[]);
  await page.getByRole('main').getByRole('button',{name:'Proof',exact:true}).click();assert.match(await page.locator('pre.build-code').last().innerText(),new RegExp(run.proof.receipt_sha256));
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Pobierz zapis misji',exact:true}).click();
  const download=await downloadPromise;const downloaded=JSON.parse(await readFile(await download.path(),'utf8'));verifyCompletedMission(downloaded);
  assert.equal(downloaded.mission.mission_id,run.proof.mission_id);
  const record=await (await fetch(`${base}/api/missions/${encodeURIComponent(run.proof.mission_id)}`,{headers:{authorization:`Bearer ${session.token}`}})).json();
  verifyCompletedMission(record);assert.match(record.brain.memory.text,new RegExp(marker));assert.equal(record.brain.memory.scope.mission_id,record.mission.mission_id);
  const wrong=state.sessions.create({...identity,identity_id:'foreign-project',project_ids:['other-project']});
  assert.equal((await fetch(`${base}/api/missions/${encodeURIComponent(record.mission.mission_id)}`)).status,401);
  assert.equal((await fetch(`${base}/api/missions/${encodeURIComponent(record.mission.mission_id)}`,{headers:{authorization:`Bearer ${wrong.token}`}})).status,403);
  const deniedMission={...record.mission,mission_id:`denied_${randomUUID()}`,input:{...record.mission.input,repository:'unauthorized/repository'}};
  const headers={'content-type':'application/json',authorization:`Bearer ${session.token}`};
  assert.equal((await fetch(`${base}/api/missions`,{method:'POST',headers,body:JSON.stringify(deniedMission)})).status,201);
  const deniedRun=await fetch(`${base}/api/missions/${deniedMission.mission_id}/run`,{method:'POST',headers,body:'{}'});
  assert.equal(deniedRun.status,201);assert.notEqual((await deniedRun.json()).verdict,'VERIFIED');assert.equal(executions,2);
  const changed=structuredClone(record);changed.run.evidence[0].data.sha256='0'.repeat(64);assert.throws(()=>verifyCompletedMission(changed),/rejected/);
  const oldReceipt=record.mission_receipt.receipt_sha256;await page.close();await new Promise(r=>server.close(r));server=undefined;await closeBrain();brain=await startBrain();adapter=memory();
  const recovered=await adapter.readEvent(scope,memoryReceipt.document_id);assert.equal(recovered.receipt.receipt_sha256,memoryReceipt.receipt_sha256);
  const restored=await new FileMissionStore(join(dir,'missions')).get(record.mission.mission_id);verifyCompletedMission(restored);assert.equal(restored.mission_receipt.receipt_sha256,oldReceipt);
  const output=join(root,'docs/final-boss/evidence'),content=JSON.stringify(record,null,2)+'\n',suffix=mobile?'-mobile':'';await writeFile(join(output,`browser-neurosa${suffix}-mission.json`),content);
  const summary={schema:'osa.final-boss.browser-neurosa.v1',mission_id:record.mission.mission_id,run_id:run.run_id,execution_id:run.execution_id,
    mission_receipt_sha256:oldReceipt,proof_receipt_sha256:run.proof.receipt_sha256,memory_receipt_sha256:memoryReceipt.receipt_sha256,
    memory_context_sha256:record.brain.memory.context_sha256,record_sha256:createHash('sha256').update(content).digest('hex'),events:record.timeline.length,evidence:run.evidence.length,
    checks:['studio_browser_mission_created','synthetic_authenticated_session','anonymous_and_foreign_project_denied','real_neurosa_recall','native_brain_plan','two_real_fixed_file_reads_sequential','unauthorized_repository_not_verified','proof_displayed','mission_record_download_and_verification','tamper_denied','neurosa_and_mission_store_restart'],
    viewport:mobile?'390x844':'1440x900',limitations:['test_identity_injected','test_executors_not_sandboxed','no_production','viewport_emulation','replay_ui_not_exercised_in_this_test','no_external_attestation']};
  await writeFile(join(output,`browser-neurosa${suffix}-result.json`),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await closeBrain();if(dir)await rm(dir,{recursive:true,force:true});});
