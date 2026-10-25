import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createMichaelAngeloFleetExecutor, loadMichaelAngeloFleetOptions, MICHAEL_ANGELO_EXECUTOR_REF } from "../packages/fleet/src/michael-angelo";
import { ExecutorRegistry, OsaRuntime } from "../packages/runtime/src";
import { verifyProofReceipt } from "../packages/proof-core/src";
import type { TeamGraph, Mission } from "../packages/contracts/src";

const secret = "A".repeat(40);
const execId = "exec_12345678-1234-4123-8123-123456789abc";
const missionId = "osa-p0a-telemetry";
const team:TeamGraph = {organization_id:"org_p0a",project_id:"project_p0a",team_id:"fleet-michael",version:"1",
  agents:[{agent_id:"michael",role:"Michael Angelo remote worker",executor_ref:MICHAEL_ANGELO_EXECUTOR_REF}],edges:[]};
const mission:Mission = {organization_id:team.organization_id,project_id:team.project_id,team_id:team.team_id,team_version:team.version,
  mission_id:missionId,objective:"Przeprowadź audyt P0-A",entry_agent_id:"michael",input:{},requirements:[
    {requirement_id:"remote_report_received",type:"evidence_field_equals",evidence_kind:"michael_angelo_remote_report",field:"status",expected:"REMOTE_COMPLETED_UNVERIFIED"}]};

async function backend(fn:(path:string,method:string,body:unknown,headers:Record<string,unknown>)=>{status:number;body:unknown}, execute:(url:string)=>Promise<void>) {
  const server:Server = createServer(async(req,res)=>{
    const chunks:Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    let body:unknown;
    try { body=JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
    const r=fn(req.url??"/",req.method??"GET",body,req.headers);
    res.writeHead(r.status,{"content-type":"application/json"});
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const address=server.address();if(!address||typeof address==="string")throw Error("bind");
    await execute("http://127.0.0.1:"+address.port);
  } finally { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
}

test("Michael Angelo: disabled by default, rejects incomplete config and untrusted origins",()=>{
  assert.equal(loadMichaelAngeloFleetOptions({}),undefined);
  assert.throws(()=>loadMichaelAngeloFleetOptions({OSA_MICHAEL_ANGELO_ENABLED:"true"}),/NOT_CONFIGURED/);
  assert.throws(()=>createMichaelAngeloFleetExecutor({baseUrl:"http://example.com",token:secret}),/ORIGIN_INVALID/);
  assert.throws(()=>createMichaelAngeloFleetExecutor({baseUrl:"https://example.com",token:"short"}),/TOKEN_REQUIRED/);
});

test("Michael Angelo: real HTTP contract over loopback, authenticated, correlated and proof bound",async()=>{
  const paths:string[]=[];
  await backend((path,method,body,headers)=>{
    assert.equal(headers.authorization,"Bearer "+secret);
    assert.equal(headers["x-osa-execution-id"],execId);
    paths.push(method+" "+path);
    if(path==="/v1/status")return{status:200,body:{ok:true}};
    if(path==="/v1/missions"&&method==="POST"){
      assert.equal((body as {mode:string}).mode,"ARCHITECT");
      return{status:201,body:{id:"msn-123",state:"CREATED"}};
    }
    if(path==="/v1/missions/msn-123/transition") {
      assert.deepEqual(body,{state:"QUEUED"});
      return{status:200,body:{id:"msn-123",state:"QUEUED"}};
    }
    if(path==="/v1/missions/msn-123")return{status:200,body:{id:"msn-123",state:"COMPLETED",proofHash:"untrusted"}};
    return{status:404,body:{error:"missing"}};
  },async url=>{
    const registry=new ExecutorRegistry();
    registry.register(MICHAEL_ANGELO_EXECUTOR_REF,createMichaelAngeloFleetExecutor({baseUrl:url,token:secret,pollIntervalMs:10}));
    const run=await new OsaRuntime(registry,{createExecutionId:()=>execId}).run(team,mission);
    assert.equal(run.execution_id,execId);
    assert.equal(run.verdict,"VERIFIED"); // only receipt integrity and bridge's self-report field
    assert.equal((run.final_output as {verification_scope:string}).verification_scope,"REMOTE_SELF_REPORT_UNVERIFIED");
    assert.equal(run.evidence.some(e=>e.kind==="michael_angelo_remote_report"),true);
    assert.equal(verifyProofReceipt({receipt:run.proof,evidence:run.evidence,observations:run.observations,final_output:run.final_output}).ok,true);
    assert.equal(JSON.stringify(run).includes(secret),false);
  });
  assert.deepEqual(paths,["GET /v1/status","POST /v1/missions","POST /v1/missions/msn-123/transition","GET /v1/missions/msn-123"]);
});

test("Michael Angelo: unavailable backend fails closed and cannot dispatch",async()=>{
  let posts=0;
  await backend((path,method)=>{
    if(method==="POST")posts++;
    return{status:503,body:{ok:false}};
  },async url=>{
    const executor=createMichaelAngeloFleetExecutor({baseUrl:url,token:secret});
    const registry=new ExecutorRegistry();registry.register(MICHAEL_ANGELO_EXECUTOR_REF,executor);
    const run=await new OsaRuntime(registry,{createExecutionId:()=>execId}).run(team,mission);
    assert.notEqual(run.verdict,"VERIFIED");
    assert.equal(run.proof.verdict,"FAILED");
  });
  assert.equal(posts,0);
});

test("Michael Angelo: remote failure never claims verified execution",async()=>{
  await backend((path)=>{
    if(path==="/v1/status")return{status:200,body:{ok:true}};
    if(path==="/v1/missions")return{status:201,body:{id:"msn-err",state:"CREATED"}};
    if(path.endsWith("/transition"))return{status:200,body:{id:"msn-err",state:"QUEUED"}};
    return{status:200,body:{id:"msn-err",state:"FAILED"}};
  },async url=>{
    const registry=new ExecutorRegistry();
    registry.register(MICHAEL_ANGELO_EXECUTOR_REF,createMichaelAngeloFleetExecutor({baseUrl:url,token:secret}));
    const run=await new OsaRuntime(registry,{createExecutionId:()=>execId}).run(team,mission);
    assert.notEqual(run.verdict,"VERIFIED");
    assert.equal(run.evidence.some(e=>e.kind==="michael_angelo_remote_report"),false);
  });
});
