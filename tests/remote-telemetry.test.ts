import test from "node:test";
import assert from "node:assert/strict";
import { RemoteWorkspaceProvider } from "../packages/workspace-runtime/src";

const execution_id = "exec_12345678-1234-4123-8123-123456789abc";

test("remote worker: propagates the same execution ID to create/exec/write/ports/stop",async()=>{
  const calls: Array<{url:string; method:string; execution:string|undefined}> = [];
  const stub: typeof fetch = async (input,init)=>{
    const path = new URL(String(input)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({url:path,method:init?.method??"GET",execution:headers.get("x-osa-execution-id")??undefined});
    const data = path==="/v1/workspaces" ?
      {workspace:{id:"ws_1",rootDir:"/workspace",metadata:{scope:JSON.parse(String(init?.body)).scope}}}:
      path.endsWith("/exec") ? {exitCode:0,stdout:"ok",stderr:""} :
      path.includes("/ports/") ? {url:"http://127.0.0.1:3000"} : {ok:true};
    return new Response(JSON.stringify(data),{status:200,headers:{"content-type":"application/json"}});
  };
  const provider=new RemoteWorkspaceProvider({baseUrl:"http://127.0.0.1:8787",token:"test-worker-token",fetchImpl:stub});
  const workspace=await provider.create({
    workspaceId:"ws_1",timeoutMs:1000,
    scope:{organization_id:"org",project_id:"project",mission_id:"mission",task_id:"task",execution_id}
  });
  await workspace.exec("echo",["hello"]);
  await workspace.writeFile("/workspace/artifact.txt","content");
  await workspace.exposePort?.(3000);
  await workspace.stop();
  assert.equal(calls.length,5);
  assert.ok(calls.every(x=>x.execution===execution_id));
  assert.deepEqual(calls.map(x=>x.method),["POST","POST","PUT","GET","DELETE"]);
});

test("remote worker: invalid execution ID is not forwarded",async()=>{
 const headers:string[]=[];
 const stub:typeof fetch=async(_input,init)=>{
   headers.push(new Headers(init?.headers).get("x-osa-execution-id")??"");
   return new Response(JSON.stringify({workspace:{id:"w1",rootDir:"/workspace",metadata:{
     scope:JSON.parse(String(init?.body)).scope}}}),{status:200});
 };
 const provider=new RemoteWorkspaceProvider({baseUrl:"http://127.0.0.1:8787",token:"test-worker-token",fetchImpl:stub});
 await provider.create({workspaceId:"w1",timeoutMs:1000,scope:{organization_id:"o",project_id:"p",mission_id:"m",task_id:"t",execution_id:"malformed"}});
 assert.deepEqual(headers,[""]);
});
