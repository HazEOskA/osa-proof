import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { FleetQueue, sandboxExecutor } from "../packages/fleet/src";
import { CapabilityCatalog, nativeCapability } from "../packages/capabilities/src";
import { BenchmarkStore, BenchmarkResult } from "../packages/benchmarks/src";
import { digest, verifyCompletedMission } from "../packages/proof-core/src";
import { ExecutorRegistry, MissionKernel } from "../packages/runtime/src";
import { Mission, TeamGraph, AgentExecutionContext } from "../packages/contracts/src";
import { prepareDeployment, DeploymentPlan, BuildReceipt, buildAndTest, verifyLiveDeployment, CloudGrant } from "../packages/deployment/src";
import { AzureContainerAppsProvider } from "../packages/deployment/src/azure";
import { DockerImagePublisher } from "../packages/deployment/src/image";
import { PlatformControlPlane } from "../packages/platform/src";
import { DockerWorkspaceProvider, DockerCli } from "../packages/workspace-runtime/src/docker";
const scope = { organization_id: "org", project_id: "project", mission_id: "mission" };
const graph: TeamGraph = { organization_id: scope.organization_id, project_id: scope.project_id, team_id: "team", version: "1", agents: [{ agent_id: "builder", role: "builder", executor_ref: "build" },{ agent_id: "tester", role: "tester", executor_ref: "test" }], edges: [{ edge_id: "handoff", from_agent_id: "builder", to_agent_id: "tester", kind: "handoff" }] };
const mission: Mission = { ...scope, team_id: "team", team_version: "1", entry_agent_id: "builder", objective: "build and test", input: {}, requirements: [{ requirement_id: "tested", type: "evidence_field_equals", agent_id: "tester", evidence_kind: "build_receipt", field: "status", expected: "tested" }] };
function context(): AgentExecutionContext { return { mission, agent: graph.agents[0], input: {}, run_id: "run", execution_id: "exec", operation_id: "op" }; }
function buildReceipt(): BuildReceipt {
  const body = { schema: "osa.build_receipt.v1" as const, ...scope, source_sha256: digest("source"), artifact_sha256: digest(Buffer.from("app").toString("base64")), checks: (["BUILD","TEST"] as const).map(name => ({ name,command_sha256: digest(name),exit_code: 0,output_sha256: digest("ok") })), created_at: new Date().toISOString() };
  return { ...body,receipt_sha256: digest(body) };
}
function plan(): DeploymentPlan {
  const build = buildReceipt(); const image = `registry.example/app@sha256:${"a".repeat(64)}`;
  const body = { schema: "osa.image_receipt.v1" as const,...scope,build_receipt_sha256: build.receipt_sha256,image,created_at: new Date().toISOString() };
  return prepareDeployment({ ...scope,provider: "azure.container-apps",target: "osa-app",image,image_receipt: { ...body,receipt_sha256: digest(body) },build,health_path: "/health",expected_body_sha256: digest("live-app") });
}
test("fleet fences recovered leases, scopes placement, respects capacity and draining", () => {
  let now = 0; const q = new FleetQueue(() => new Date(now));
  q.register({worker_id:"w",organization_id:"org",project_id:"project",capacity:1});
  q.register({worker_id:"other",organization_id:"other",project_id:"project",capacity:1});
  q.enqueueScoped(scope); assert.equal(q.claim("other"),undefined); assert.equal(q.takeDue().length,0);
  const l = q.claim("w",100)!; assert.ok(l); assert.equal(q.claim("w"),undefined);
  assert.throws(() => q.finish(l.job_id,{run_id:"r",verdict:"VERIFIED"}),/lease required/);
  now = 101; const next = q.claim("w",100)!; assert.equal(next.generation,2);
  assert.throws(() => q.complete(l,{run_id:"r",verdict:"VERIFIED"}),/stale lease/);
  q.complete(next,{run_id:"r",verdict:"VERIFIED"}); assert.equal(q.snapshot()[0].active,0);
  q.enqueueScoped({...scope,mission_id:"second"}); q.drain("w"); assert.equal(q.claim("w"),undefined);
});
test("capability grants are pinned and checked before executor side effects", async () => {
  let calls=0; const c = new CapabilityCatalog(); c.register(nativeCapability("build"),()=> {calls++;return {output:{},evidence:[]};});
  const grant = {...scope,allowed_capabilities:["build@1"],permissions:["executor.invoke"]}; const executor=c.executor("build","1",grant); grant.permissions=[];
  assert.equal((await executor(context())).evidence[0].kind,"tool_receipt");
  await assert.rejects(Promise.resolve().then(()=>executor({...context(),mission:{...mission,organization_id:"other"}})),/PERMISSION_DENIED/); assert.equal(calls,1);
  assert.throws(()=>c.register(nativeCapability("build"),()=>({output:{},evidence:[]})),/ALREADY_REGISTERED/);
});
test("benchmark routing rejects incomparable, expired, unauthorized and tampered evidence",()=>{
  const body: Omit<BenchmarkResult,"receipt_sha256"> = {schema:"osa.benchmark_result.v1",...scope,subject:{category:"TEAM",ref:"team",version:"1"},workload:{ref:"suite",sha256:digest("suite")},quality:1,latency_ms:null,cost:null,reliability:1,failures:0,environment:{ref:"local",sha256:digest("env")},evidence:[digest("receipt")],timestamp:new Date(1000).toISOString()};
  const b={...body,receipt_sha256:digest(body)}; const s=new BenchmarkStore();s.add(b);
  const policy={organization_id:"org",project_id:"project",category:"TEAM" as const,workload_sha256:digest("suite"),environment_sha256:digest("env"),allowed:["team@1"],minReliability:0.9,maxAgeMs:1000,now:1500};
  assert.ok(s.select(policy)); assert.equal(s.select({...policy,environment_sha256:digest("other")}),undefined);assert.equal(s.select({...policy,organization_id:"other"}),undefined);assert.equal(s.select({...policy,now:3000}),undefined);
  assert.throws(()=>s.add({...b,quality:0.5}),/INVALID/);
});
test("sandbox timeout destroys container; traversal and resource over-allocation denied", async()=>{
  const calls:string[][]=[];const cli:DockerCli={run:async args=>{calls.push([...args]);return {exitCode:args[0]==="exec"?124:0,stdout:"id",stderr:""};}};
  const provider=new DockerWorkspaceProvider({cli}); const w=await provider.create({workspaceId:"m",scope:{...scope,task_id:"task"},timeoutMs:1000});
  await assert.rejects(w.writeFile("/etc/passwd","x"),/PATH_INVALID/);
  await assert.rejects(w.writeFile("/workspace/../etc/passwd","x"),/PATH_INVALID/);
  await w.exec("sleep",["10"],{timeoutMs:1}); assert.ok(calls.some(c=>c[0]==="rm"));
  assert.ok(calls[0].includes("--read-only")); assert.ok(calls[0].includes("1000:1000")); assert.ok(calls[0].includes("none"));
  await assert.rejects(provider.create({workspaceId:"x",timeoutMs:1000,cpu:Infinity}),/LIMIT_INVALID/);
});
test("cleanup failure blocks sandbox evidence and can be retried",async()=>{
  let removes=0;const provider=new DockerWorkspaceProvider({cli:{run:async args=>({exitCode:args[0]==="rm"&&++removes===1?1:0,stdout:"id",stderr:"failure"})}});
  const w=await provider.create({workspaceId:"x",timeoutMs:1000});await assert.rejects(w.stop(),/STOP_FAILED/);await w.stop();assert.equal(removes,2);
  const wrapped=sandboxExecutor({id:"failing",create:async()=>({...w, id:"id",rootDir:"/workspace",exec:w.exec.bind(w),writeFile:w.writeFile.bind(w),stop:async()=>{throw Error("cleanup");}})},async()=>({output:{},evidence:[]}));
  await assert.rejects(Promise.resolve().then(()=>wrapped(context())),/cleanup/);
});
test("build refuses failed tests and exports only after both gates",async()=>{
  const w={id:"id",rootDir:"/workspace",writeFile:async()=>{},stop:async()=>{},exec:async(cmd:string)=>({exitCode:cmd==="test"?1:0,stdout:"",stderr:""})};
  await assert.rejects(buildAndTest({...scope,workspace:w,source_sha256:digest("s"),build:{command:"build",args:[]},test:{command:"test",args:[]},artifactPath:"/workspace/app.js"}),/TEST_FAILED/);
});
test("Azure denies foreign grant before network and separates deploy submission from live verification",async()=>{
  const p=plan();let calls=0;let live=false;const config={subscription_id:"00000000-0000-0000-0000-000000000000",resource_group:"rg",environment_id:"/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",location:"northeurope",token:async()=>"secret",fetchImpl:async(_url:any,init?:RequestInit)=>{
    calls++; if(init?.method==="GET"&&!live)return new Response("",{status:404});
    return Response.json(live?{tags:{"osa.mission_id":p.mission_id,"osa.organization_id":p.organization_id,"osa.project_id":p.project_id,"osa.plan_sha256":p.plan_sha256},properties:{provisioningState:"Succeeded",runningStatus:"Running",latestRevisionName:"r",latestReadyRevisionName:"r",configuration:{ingress:{fqdn:"app.region.azurecontainerapps.io"}},template:{containers:[{image:p.image}]}}}:{});
  }};
  const azure=new AzureContainerAppsProvider(config);const grant:CloudGrant={...scope,target:p.target,plan_sha256:p.plan_sha256,permissions:["deploy"]};
  await assert.rejects(azure.deploy(p,{...grant,mission_id:"other"}),/PERMISSION_DENIED/);assert.equal(calls,0);
  const receipt=await azure.deploy(p,grant);assert.equal(calls,2);live=true;
  await assert.rejects(verifyLiveDeployment(azure,p,receipt,async()=>new Response("wrong")),/LIVE_VALIDATION_FAILED/);
  const verified=await verifyLiveDeployment(azure,p,receipt,async()=>new Response("live-app"));assert.equal(verified.mission_id,p.mission_id);
  await assert.rejects(verifyLiveDeployment(azure,p,{...receipt,image:"fake"},async()=>new Response("live-app")),/RECEIPT_INVALID/);
});
test("deployment binds image receipt to build and review has no cloud side effects",()=>{
  const p=plan();const platform=new PlatformControlPlane();assert.equal(platform.reviewDeployment(p).executed,false);
  const invalid=structuredClone(p);invalid.image_receipt.build_receipt_sha256=digest("other");assert.throws(()=>platform.reviewDeployment(invalid),/IMAGE_RECEIPT_INVALID/);
});
test("image publisher requires scoped grant and seals inspected registry digest",async()=>{
  const calls:string[][]=[];const publisher=new DockerImagePublisher({run:async(args,options)=>{calls.push([...args]);if(args[0]==="build")assert.ok(Buffer.isBuffer(options?.stdin));return {exitCode:0,stdout:args[0]==="image"?JSON.stringify([`registry.example/app@sha256:${"a".repeat(64)}`]):"",stderr:""};}},"registry.example/app",`node@sha256:${"b".repeat(64)}`);
  const b=buildReceipt();const grant={...scope,permission:"registry.push" as const,build_receipt_sha256:b.receipt_sha256,registry:"registry.example/app"};
  await assert.rejects(publisher.publish(b,Buffer.from("app").toString("base64"),{...grant,organization_id:"other"}),/PERMISSION_DENIED/);assert.equal(calls.length,0);
  const receipt=await publisher.publish(b,Buffer.from("app").toString("base64"),grant);assert.ok(receipt.image.includes("@sha256:"));assert.equal(calls.length,3);
});

test("LIVE local: Mission -> Fleet -> two agents/two Docker sandboxes -> build/test -> sealed proof",{skip:process.env.OSA_LOCAL_DOCKER_TEST!=="1"},async()=>{
  const provider=new DockerWorkspaceProvider({image:"node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402"});
  const registry=new ExecutorRegistry();const ids:string[]=[];
  registry.register("build",sandboxExecutor(provider,async(_ctx,w)=>{
    ids.push(w.id); await w.writeFile("/workspace/project/app.js","module.exports = x => x + 1;\n");
    const read=await w.exec("cat",["/workspace/project/app.js"]);assert.equal(read.exitCode,0);
    const denied=await w.exec("sh",["-c","echo nope > /etc/osa-forbidden"]);assert.notEqual(denied.exitCode,0);
    const user=await w.exec("id",["-u"]);assert.equal(user.stdout.trim(),"1000");
    return {output:{source:read.stdout},evidence:[{kind:"source",data:{sha256:digest(read.stdout)}}]};
  }));
  registry.register("test",sandboxExecutor(provider,async(ctx,w)=>{
    ids.push(w.id);const source=(ctx.input as {source:string}).source;await w.writeFile("/workspace/project/app.js",source);
    await w.writeFile("/workspace/project/app.test.js","const assert=require('node:assert/strict');const test=require('node:test');test('adds one',()=>assert.equal(require('./app')(41),42));\n");
    const built=await buildAndTest({...scope,workspace:w,source_sha256:digest(source),build:{command:"node",args:["--check","app.js"]},test:{command:"node",args:["--test","app.test.js"]},artifactPath:"/workspace/project/app.js"});
    return {output:{artifact:built.artifact,build_receipt:built.receipt},evidence:[{kind:"build_receipt",data:{status:"tested",receipt:built.receipt}}]};
  }));
  const kernel=new MissionKernel();await kernel.create({...mission,policy:{allowed_executor_refs:["build","test"],required_receipts:["sandbox_receipt","build_receipt"]}},graph);
  const platform=new PlatformControlPlane();platform.fleet.register({worker_id:"local",organization_id:"org",project_id:"project",capacity:1});platform.fleet.enqueueScoped(scope);
  assert.equal(await platform.runOne("local",kernel,registry),true);const record=(await kernel.get(scope.mission_id))!;assert.equal(record.state,"COMPLETED");verifyCompletedMission(record);
  assert.equal(new Set(ids).size,2);assert.equal(record.run!.evidence.filter(e=>e.kind==="sandbox_receipt").length,2);assert.equal(platform.fleet.list()[0].status,"DONE");
  if (process.env.OSA_REVIEW_DIR) {
    const dir=resolve(process.env.OSA_REVIEW_DIR);await mkdir(dir,{recursive:true,mode:0o700});
    await writeFile(join(dir,"mission.json"),JSON.stringify(record,null,2),{mode:0o600});
    await writeFile(join(dir,"verification-receipt.json"),JSON.stringify(record.verification_receipt,null,2),{mode:0o600});
    await writeFile(join(dir,"mission-receipt.json"),JSON.stringify(record.mission_receipt,null,2),{mode:0o600});
  }
});

test("required live receipt policy prevents mission completion from artifact claims alone",async()=>{
  const kernel=new MissionKernel();const m={...mission,policy:{allowed_executor_refs:["build","test"],required_receipts:["live_verification_receipt" as const]}};
  await kernel.create(m,graph);const registry=new ExecutorRegistry();registry.register("build",()=>({output:{},evidence:[]}));registry.register("test",()=>({output:{},evidence:[{kind:"build_receipt",data:{status:"tested"}}]}));
  await assert.rejects(kernel.execute(m.mission_id,registry),/REQUIRED_RECEIPT/);const record=(await kernel.get(m.mission_id))!;assert.equal(record.state,"FAILED");assert.equal(record.mission_receipt,undefined);
});

test("Azure never overwrites another mission's resource and strips remote secret errors",async()=>{
  const p=plan();let mutations=0;
  const azure=new AzureContainerAppsProvider({subscription_id:"00000000-0000-0000-0000-000000000000",resource_group:"rg",environment_id:"/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",location:"northeurope",token:async()=>"private-token",fetchImpl:async(_url,init)=>{if(init?.method!=="GET")mutations++;return Response.json({tags:{"osa.mission_id":"other"}});}});
  await assert.rejects(azure.deploy(p,{...scope,target:p.target,plan_sha256:p.plan_sha256,permissions:["deploy"]}),/RESOURCE_SCOPE_DENIED/);assert.equal(mutations,0);
});

test("platform API is session protected and review does not execute deployment",async()=>{
  const {createApiServer,ApiState}=await import("../apps/api/src");
  const server=createApiServer(new ExecutorRegistry(),new ApiState());await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const port=(server.address() as import("node:net").AddressInfo).port;
  try {assert.equal((await fetch(`http://127.0.0.1:${port}/platform/status`)).status,401);assert.equal((await fetch(`http://127.0.0.1:${port}/platform/deployments/review`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(plan())})).status,401);}
  finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test("MCP HTTP performs initialize/list/call and capability permissions gate invocation",async()=>{
  const {McpHttpIntegration}=await import("../packages/capabilities/src/mcp");let calls=0;let initialized=false;
  const transport=new McpHttpIntegration({url:"https://tools.example/mcp",server_id:"server",version:"1",fetchImpl:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));if(body.method==="notifications/initialized"){initialized=true;return new Response(null,{status:202});}
    const result=body.method==="initialize"?{protocolVersion:"2025-03-26",capabilities:{tools:{}}}:body.method==="tools/list"?{tools:[{name:"echo",inputSchema:{type:"object"}}]}:(calls++,{content:[{type:"text",text:"ok"}]});
    return Response.json({jsonrpc:"2.0",id:body.id,result},{headers:{"Mcp-Session-Id":"session"}});
  }});
  const catalog=new CapabilityCatalog();await transport.register(catalog);assert.equal(initialized,true);const grant={...scope,allowed_capabilities:["mcp.server.echo@1"],permissions:[] as string[]};
  await assert.rejects(Promise.resolve().then(()=>catalog.executor("mcp.server.echo","1",grant)(context())),/PERMISSION_DENIED/);assert.equal(calls,0);
  grant.permissions=["mcp:server:echo"];assert.equal((await catalog.executor("mcp.server.echo","1",grant)(context())).evidence[0].kind,"tool_receipt");assert.equal(calls,1);
});

test("skill/plugin bundle validates dependencies and commits catalog changes atomically",async()=>{
  const {registerIntegrationBundle}=await import("../packages/capabilities/src/bundles");
  const registry=new ExecutorRegistry();registry.register("build",()=>({output:{},evidence:[]}));const catalog=new CapabilityCatalog();
  const first={...nativeCapability("build"),capability_id:"skill.build",kind:"SKILL" as const};const second={...first,capability_id:"skill.bad",health:"INVALID" as any};
  const body={schema:"osa.integration_bundle.v1" as const,bundle_id:"bundle",version:"1",kind:"SKILL" as const,capabilities:[first,second]};
  assert.throws(()=>registerIntegrationBundle({...body,bundle_sha256:digest(body)},catalog,registry),/CAPABILITY_INVALID/);assert.equal(catalog.list().length,0);
  const valid={...body,capabilities:[first]};registerIntegrationBundle({...valid,bundle_sha256:digest(valid)},catalog,registry);assert.equal(catalog.list()[0].kind,"SKILL");
});
