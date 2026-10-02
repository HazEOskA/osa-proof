import { randomUUID, createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { AgentExecutionContext, AgentExecutor, EvidenceInput, Mission, MissionRecord, TeamGraph } from '../../contracts/src';
import { ExecutorRegistry } from '../../runtime/src';
import { digest, verifyCompletedMission, verifyProofReceipt } from '../../proof-core/src';
import { buildAndTest, verifyBuildReceipt, BuildReceipt } from '../../deployment/src';
import { WorkspaceProvider } from '../../workspace-runtime/src';

export const DEMO_TEMPLATE_ID = 'osa.delivery-lab';
export const DEMO_VERSION = '0.1.0';
export type DemoStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN' | 'NOT_REQUIRED';
export interface DemoRequest {
  objective: string;
  kind: 'document' | 'webapp' | 'other';
  mode: 'starter' | 'connected';
  target: 'artifact' | 'sandbox' | 'azure';
}
export interface DemoCheck { stage: string; status: DemoStatus; detail: string; evidence_kind: string; latency_ms: number }
export interface DemoArtifact { name: string; media_type: string; content: string; sha256: string; bytes: number }
export interface DemoOutput {
  request: DemoRequest; checks: DemoCheck[]; artifact?: DemoArtifact;
  plan?: unknown; build_receipt?: BuildReceipt; ready_for_review?: boolean;
}
export interface DemoOptions { executionMode: string; workspace?: WorkspaceProvider }
export const DEMO_ROLES = [
  ['intake', 'Input & scope'], ['planner', 'Plan'], ['producer', 'Artifact producer'],
  ['inspector', 'Artifact inspector'], ['policy', 'Policy gate'], ['builder', 'Sandbox build'],
  ['tester', 'Test verifier'], ['delivery', 'Delivery gate'], ['reviewer', 'Coverage & gaps'], ['reporter', 'Evidence reporter'],
] as const;
export function validateDemoRequest(value: unknown): DemoRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_REQUEST_INVALID');
  const r = value as Record<string,unknown>;
  if (Object.keys(r).some(k => !['objective','kind','mode','target'].includes(k)) || typeof r.objective !== 'string' || !r.objective.trim() || r.objective.length > 4000 ||
      !['document','webapp','other'].includes(String(r.kind)) || !['starter','connected'].includes(String(r.mode)) || !['artifact','sandbox','azure'].includes(String(r.target))) throw new Error('DEMO_REQUEST_INVALID');
  return { objective:r.objective.trim(), kind:r.kind as DemoRequest['kind'], mode:r.mode as DemoRequest['mode'], target:r.target as DemoRequest['target'] };
}
export function demoTeam(scope: {organization_id:string;project_id:string}): TeamGraph {
  return {...scope,team_id:`${DEMO_TEMPLATE_ID}:${scope.organization_id}`,version:DEMO_VERSION,
    agents:DEMO_ROLES.map(([id,role]) => ({agent_id:id,role,executor_ref:`demo.${id}.v1`})),
    edges:DEMO_ROLES.slice(1).map(([id],i) => ({edge_id:`${DEMO_ROLES[i][0]}_${id}`,from_agent_id:DEMO_ROLES[i][0],to_agent_id:id,kind:'handoff' as const}))};
}
export function demoMission(request:DemoRequest, team:TeamGraph): Mission {
  return {organization_id:team.organization_id,project_id:team.project_id,mission_id:`demo_${randomUUID()}`,team_id:team.team_id,team_version:team.version,
    objective:request.objective,entry_agent_id:'intake',input:request,
    policy:{allowed_executor_refs:team.agents.map(a=>a.executor_ref),required_receipts:request.target==='azure'?['build_receipt','image_receipt','deployment_receipt','live_verification_receipt']:request.target==='sandbox'?['build_receipt']:[]},budget:{max_tasks:10,max_context_chars:12000},
    requirements:[{requirement_id:'delivery_ready_for_review',type:'evidence_field_equals',agent_id:'reporter',evidence_kind:'demo_completion',field:'ready_for_review',expected:true}]};
}
const sha = (text:string) => createHash('sha256').update(text).digest('hex');
const escapeHtml = (text:string) => text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function starter(request:DemoRequest):string {
  if(request.kind==='document') return `# ${request.objective}\n\n## Objective\n${request.objective}\n\n## Scope\nThis is a deterministic starter document produced by OSA Delivery Lab, not researched or model-generated content.\n\n## Plan\n1. Confirm requirements and sources.\n2. Draft the requested sections.\n3. Review accuracy and citations.\n4. Accept the final deliverable.\n\n## Acceptance checklist\n- [ ] Human confirms that this document addresses the objective.\n- [ ] Facts and citations are reviewed.\n\n## Limitations\nThe framework verifies bytes and structural checks. Semantic quality and factual accuracy are unverified.\n`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>OSA Delivery Lab</title><style>body{margin:0;background:#f6f7fb;color:#1e2940;font:16px system-ui}main{max-width:740px;margin:8vh auto;padding:24px}h1{font-size:36px}input,button{font:inherit;padding:12px;border:1px solid #9da9be;border-radius:8px}button{background:#4248cd;color:white;cursor:pointer}li{padding:12px;border-bottom:1px solid #ccd2e0}small{color:#46536a}</style></head><body><main><small>OSA · deterministic starter webapp</small><h1>${escapeHtml(request.objective)}</h1><p>A working task list starter. It does not interpret arbitrary application requirements.</p><div id="tasks"><label for="task">Task</label> <input id="task" maxlength="160" required> <button type="button" id="add-task">Add task</button></div><ul id="list"></ul><p id="count" role="status">0 tasks</p><small>No backend, cloud deployment or persistent database is included.</small></main><script>document.getElementById('add-task').addEventListener('click',function(){var input=document.getElementById('task');var text=input.value.trim();if(!text)return;var item=document.createElement('li');item.textContent=text;document.getElementById('list').appendChild(item);input.value='';document.getElementById('count').textContent=document.querySelectorAll('#list li').length+' tasks';});</script></body></html>`;
}
export function inspectArtifact(artifact:DemoArtifact, kind:DemoRequest['kind']):string[] {
  const failures:string[]=[];
  if(!artifact.content.trim() || artifact.bytes!==Buffer.byteLength(artifact.content) || artifact.sha256!==sha(artifact.content) || artifact.bytes>128*1024) failures.push('Artifact content or digest invalid.');
  if(kind==='document' && !/^#\s+\S/m.test(artifact.content)) failures.push('Markdown heading required.');
  if(kind==='webapp') {
    if(!/^\s*<!doctype html>/i.test(artifact.content) || !/<title>[^<]+<\/title>/i.test(artifact.content) || !/<body[\s>]/i.test(artifact.content)) failures.push('Standalone HTML document required.');
    // Syntax parsing only; untrusted generated JavaScript is NEVER run in the control plane.
    for(const match of artifact.content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {new Script(match[1]);} catch {failures.push('Inline JavaScript syntax invalid.');}
    }
  }
  return failures;
}
export function installDemoExecutors(registry:ExecutorRegistry, options:DemoOptions):void {
  function stage(id:string, action:(state:DemoOutput,c:AgentExecutionContext)=>Promise<{status:DemoStatus;detail:string;evidence?:EvidenceInput[]}>|{status:DemoStatus;detail:string;evidence?:EvidenceInput[]}):void {
    const executor:AgentExecutor=async context=>{
      const started=performance.now();
      const state:DemoOutput=id==='intake'?{request:validateDemoRequest(context.mission.input),checks:[]}:structuredClone(context.input as DemoOutput);
      if(digest(state.request)!==digest(validateDemoRequest(context.mission.input))) throw new Error('DEMO_INPUT_BINDING_INVALID');
      const result=await action(state,context);
      const kind=`demo_${id}`;
      const check:DemoCheck={stage:id,status:result.status,detail:result.detail,evidence_kind:kind,latency_ms:Math.round((performance.now()-started)*1000)/1000};
      state.checks.push(check);
      return {output:state,evidence:[{kind,data:{...check}},...(result.evidence??[])]};
    };
    registry.register(`demo.${id}.v1`,executor);
  }
  stage('intake',state=>({status:state.request.kind==='other'?'BLOCKED':'PASS',detail:state.request.kind==='other'?'No executor exists in this template for this output type.':'Objective and bounded delivery contract validated.'}));
  stage('planner',async(state,c)=>{
    if(state.request.kind==='other')return {status:'BLOCKED',detail:'Unsupported output type.'};
    if(state.request.mode==='connected') {
      if(options.executionMode!=='provider')return {status:'BLOCKED',detail:'Model execution is not configured; fixture is not substituted.'};
      try {const result=await registry.get('dev.planner.v1')(c);const output=result.output as {plan?:unknown};if(!output?.plan || typeof output.plan!=='object')return {status:'FAIL',detail:'Existing planner rejected the plan.',evidence:result.evidence};state.plan=output.plan;return {status:'PASS',detail:'Existing provider planner returned a validated plan; semantic quality is not proven.',evidence:result.evidence};}catch{return {status:'FAIL',detail:'Provider planning failed; no fallback claim.'};}
    }
    state.plan={summary:state.request.objective,steps:['Generate deterministic starter','Check artifact structure and bytes','Run requested delivery gates','Report gaps and proof']};
    return {status:'PASS',detail:'Native deterministic plan. No model reasoning or arbitrary objective completion claimed.'};
  });
  stage('producer',async(state,c)=>{
    if(!state.plan)return {status:'BLOCKED',detail:'Accepted plan missing.'};
    let content:string;
    let evidence:EvidenceInput[]=[];
    if(state.request.mode==='connected') {
      try {
        const format=state.request.kind==='webapp'?'a self-contained HTML webapp beginning with <!doctype html>, with no external dependencies':'a complete Markdown document beginning with a heading';
        const result=await registry.get('dev.builder.v1')({...c,mission:{...c.mission,objective:`${c.mission.objective}\nDeliver ${format}. Return the full source in artifact.content. Do not claim tests, deployment or factual accuracy.`},input:{plan:state.plan}});
        const artifact=(result.output as {artifact?:{content?:unknown}})?.artifact;
        if(typeof artifact?.content!=='string')return {status:'FAIL',detail:'Existing builder did not return artifact bytes.',evidence:result.evidence};
        content=artifact.content;evidence=result.evidence;
      }catch{return {status:'FAIL',detail:'Existing provider builder failed.'};}
    }else content=starter(state.request);
    if(Buffer.byteLength(content)>128*1024)return {status:'FAIL',detail:'Artifact exceeds 128 KB.'};
    state.artifact={name:state.request.kind==='webapp'?'index.html':'document.md',media_type:state.request.kind==='webapp'?'text/html':'text/markdown',content,sha256:sha(content),bytes:Buffer.byteLength(content)};
    return {status:'PASS',detail:state.request.mode==='starter'?'Actual deterministic starter bytes produced; no arbitrary-task understanding.':'Actual bytes returned by the existing builder.',evidence:[...evidence,{kind:'demo_artifact',data:{status:'produced',name:state.artifact.name,content_sha256:state.artifact.sha256,bytes:state.artifact.bytes},content}]};
  });
  stage('inspector',state=>{if(!state.artifact)return {status:'BLOCKED',detail:'No artifact to inspect.'};const failures=inspectArtifact(state.artifact,state.request.kind);return {status:failures.length?'FAIL':'PASS',detail:failures.join(' ')||'Bytes, digest, document structure and inline script syntax checked. No browser or semantic test implied.'};});
  stage('policy',state=>({status:state.checks.some(c=>['FAIL','BLOCKED'].includes(c.status))?'BLOCKED':'PASS',detail:'Fixed commands only; no generated code executed on the API host, no secret export, no external deployment. HTML preview uses an opaque sandbox and restrictive CSP.'}));
  stage('builder',async(state,c)=>{
    if(state.request.target==='artifact')return {status:'NOT_REQUIRED',detail:'Artifact-only scope; no sandbox build requested or claimed.'};
    if(!state.artifact || state.checks.some(x=>['FAIL','BLOCKED'].includes(x.status)))return {status:'BLOCKED',detail:'Policy or artifact gate not satisfied.'};
    if(!options.workspace)return {status:'BLOCKED',detail:'No configured remote WorkspaceProvider. Set existing worker connection server-side to enable this gate.'};
    const scope={organization_id:c.mission.organization_id,project_id:c.mission.project_id,mission_id:c.mission.mission_id};
    let workspace;
    try {
      workspace=await options.workspace.create({workspaceId:`${c.mission.mission_id}-build`,scope:{...scope,task_id:`${c.mission.mission_id}:task:6`},timeoutMs:60000,cpu:1,memoryMb:512});
      await workspace.writeFile('project/source.json',JSON.stringify(state.artifact));
      // These scripts read generated bytes as data. They never run generated code.
      await workspace.writeFile('project/build.cjs',"const fs=require('fs');const a=JSON.parse(fs.readFileSync('source.json','utf8'));fs.writeFileSync('artifact.txt',a.content);console.log('Static artifact packaged');");
      await workspace.writeFile('project/test.cjs',"const fs=require('fs'),crypto=require('crypto');const a=JSON.parse(fs.readFileSync('source.json','utf8')),b=fs.readFileSync('artifact.txt');if(crypto.createHash('sha256').update(b).digest('hex')!==a.sha256||b.length!==a.bytes)process.exit(1);console.log('Artifact byte identity verified; no browser test');");
      const built=await buildAndTest({...scope,workspace,source_sha256:state.artifact.sha256,build:{command:'node',args:['build.cjs']},test:{command:'node',args:['test.cjs']},artifactPath:'/workspace/project/artifact.txt'});
      if(Buffer.from(built.artifact,'base64').toString('utf8')!==state.artifact.content)throw new Error('EXPORT_MISMATCH');
      await workspace.stop();workspace=undefined;
      state.build_receipt=built.receipt;
      return {status:'PASS',detail:'Real remote sandbox packaged/exported identical bytes and passed byte-integrity tests; sandbox stopped.',evidence:[{kind:'build_receipt',data:{receipt:built.receipt}}]};
    }catch{return {status:'FAIL',detail:'Sandbox create/build/test/export/cleanup failed; no build success claimed.'};}
    finally {if(workspace)try{await workspace.stop();}catch{/* failure already reported; no cleanup success claim */}}
  });
  stage('tester',state=>{
    if(!state.artifact)return {status:'BLOCKED',detail:'No artifact to test.'};
    if(state.request.target!=='artifact') {if(!state.build_receipt)return {status:'BLOCKED',detail:'Sandbox BuildReceipt missing.'};try{verifyBuildReceipt(state.build_receipt);}catch{return {status:'FAIL',detail:'BuildReceipt integrity invalid.'};}}
    const failures=inspectArtifact(state.artifact,state.request.kind);
    return {status:failures.length?'FAIL':'PASS',detail:failures.join(' ')||'Structural checks passed. Browser behavior, security review, factual accuracy and fitness for purpose remain UNKNOWN.'};
  });
  stage('delivery',state=>({status:state.request.target==='azure'?'BLOCKED':state.checks.some(c=>['FAIL','BLOCKED'].includes(c.status))?'BLOCKED':'PASS',detail:state.request.target==='azure'?'Azure image publishing, scoped grant and live verification are not wired into this template. No URL or deployment receipt fabricated.':'Artifact ready for human review only after the requested gates. Download is not a cloud deployment.'}));
  stage('reviewer',()=>({status:'UNKNOWN',detail:'Independent semantic review, vulnerability discovery, benchmark workload, persistent memory, parallel fleet and arbitrary output types are not exercised. No bugs found is not a security conclusion.'}));
  stage('reporter',state=>{
    state.ready_for_review=!!state.artifact && !state.checks.some(c=>c.status==='FAIL'||c.status==='BLOCKED');
    return {status:state.ready_for_review?'PASS':'BLOCKED',detail:state.ready_for_review?'Requested artifact gates met; human acceptance remains required.':'One or more required gates blocked or failed. Mission cannot be COMPLETED.',evidence:[{kind:'demo_completion',data:{ready_for_review:state.ready_for_review,checks_sha256:digest(state.checks),artifact_sha256:state.artifact?.sha256??null}}]};
  });
}
export function demoTemplate(options:DemoOptions) {
  return {template_id:DEMO_TEMPLATE_ID,version:DEMO_VERSION,name:'Delivery Lab',roles:DEMO_ROLES.map(([agent_id,role])=>({agent_id,role,executor_ref:`demo.${agent_id}.v1`})),
    execution:'Existing MissionKernel → NeurOSA → linear TeamGraph → OsaRuntime → OSA Proof',
    supported_outputs:['document','webapp'],unsupported_outputs:'Reported as BLOCKED; no universal executor is claimed.',
    modes:{starter:'Deterministic document scaffold or working task-list HTML starter; no model interpretation.',connected:options.executionMode==='provider'?'AVAILABLE: existing dev provider executors':'BLOCKED: existing execution mode is not provider'},
    sandbox:options.workspace?'CONFIGURED: existing remote WorkspaceProvider':'BLOCKED: no remote worker configured',azure:'BLOCKED: deployment adapter not wired into this template',
    verification_scope:'Artifact identity and structural checks; semantic quality and absence of vulnerabilities are UNKNOWN.',persistence:'Mission store as configured; API team/run indexes are PROCESS_MEMORY'};
}
export function demoReport(record:MissionRecord) {
  const run=record.run;
  const output=run?.final_output as DemoOutput|undefined;
  const proof=run?verifyProofReceipt({receipt:run.proof,evidence:run.evidence,observations:run.observations,final_output:run.final_output}):undefined;
  let completedIntegrity = false;
  try {verifyCompletedMission(record);completedIntegrity=true;} catch {/* failed/unfinished or tampered records are never ready */}
  return {execution_mode:output?.request.mode??null,mission_id:record.mission.mission_id,state:record.state,verdict:run?.verdict??'UNKNOWN',ready_for_review:completedIntegrity&&proof?.ok===true&&output?.ready_for_review===true,
    checks:(output?.checks??[]).map(check=>({...check,evidence_refs:run?.evidence.filter(e=>e.kind===check.evidence_kind).map(e=>({evidence_id:e.evidence_id,evidence_sha256:e.evidence_sha256}))??[]})),
    coverage:[{capability:'NeurOSA',status:record.brain?'PASS':'UNKNOWN',detail:record.brain?`${record.brain.planning_receipt.mode} planner; routing is pinned, not adaptive.`:'No accepted brain plan.'},
      {capability:'Fleet',status:'UNKNOWN',detail:'Ten roles execute sequentially in the existing runtime; distributed workers not exercised.'},
      {capability:'Benchmarks',status:'UNKNOWN',detail:'Stage latency is measured; no benchmark workload executed, cost unknown.'},
      {capability:'Memory',status:'UNKNOWN',detail:'No persistent learning or replay-after-restart test performed.'},
      {capability:'Proof',status:proof?.ok?'PASS':'FAIL',detail:'Same-process deterministic receipt integrity and declared requirements; no external attestation.'}],
    proof_id:run?.proof.proof_id??null,mission_receipt:record.mission_receipt??null,artifact:output?.artifact??null,
    limitations:['Starter output does not fulfill arbitrary objectives.','Model content is not proof of correctness.','Downloaded HTML is untrusted; preview is isolated.','Report success covers declared gates, not absence of bugs.']};
}
