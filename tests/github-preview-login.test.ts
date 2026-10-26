import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { handleGithubAuth, readGithubSession, githubOAuthConfigured } from "../apps/api/src/github-auth";

const env={
  OSA_GITHUB_CLIENT_ID:"public-client",
  OSA_GITHUB_CLIENT_SECRET:"only-test-secret",
  OSA_GITHUB_SESSION_SECRET:"test-session-signing-secret-at-least-32-characters",
  OSA_GITHUB_ALLOWED_USER_IDS:"123456",
  OSA_GITHUB_CALLBACK_ORIGIN:"https://osa-proof-three.vercel.app",
  OSA_GITHUB_ORGANIZATION_ID:"org_test",
  OSA_GITHUB_PROJECT_ID:"project_test",
};
const preview="osa-proof-git-feature-x.vercel.app";

// Node fetch normalizes Host to the connection host, so use the raw HTTP client
// to exercise the Vercel Host routing and broker binding explicitly.
async function localFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve,reject) => {
    const req=httpRequest(url,{method:init.method??"GET",headers:Object.fromEntries(new Headers(init.headers).entries())},res=>{
      const chunks:Buffer[]=[];
      res.on("data",chunk=>chunks.push(Buffer.from(chunk)));
      res.on("end",()=>{
        const headers=new Headers();
        for(const [key,value] of Object.entries(res.headers)){
          if(typeof value==="string") headers.set(key,value);
          else if(Array.isArray(value)) for(const v of value)headers.append(key,v);
        }
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode??500,headers}));
      });
      res.on("error",reject);
    });
    req.on("error",reject);
    req.end(init.body as string | undefined);
  });
}
async function serve(handler:(req:IncomingMessage)=>Promise<Response|string>, action:(base:string)=>Promise<void>) {
  const server=createServer(async(req,res)=>{
    const handled=await handleGithubAuth(req,res,env,async (input,init)=>{
      const url=String(input);
      if(url==="https://github.com/login/oauth/access_token") {
        const body=JSON.parse(String(init?.body)) as Record<string,string>;
        assert.equal(body.client_secret,env.OSA_GITHUB_CLIENT_SECRET);
        assert.match(body.code_verifier,/^[a-zA-Z0-9_-]{43,128}$/);
        return new Response(JSON.stringify({access_token:"transient-test-token"}),{status:200});
      }
      if(url==="https://api.github.com/user") {
        assert.equal(new Headers(init?.headers).get("authorization"),"Bearer transient-test-token");
        const value=await handler(req);
        return typeof value==="string" ? new Response(value,{status:500}):value;
      }
      throw Error("Unexpected external endpoint: "+url);
    });
    if(!handled){res.writeHead(404);res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const addr=server.address();
    if(!addr||typeof addr==="string")throw Error("listener");
    await action("http://127.0.0.1:"+addr.port);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
function parseCookie(header:string|null, name:string):string {
  const line=(header??"").split(", ").find(c=>c.startsWith(name+"="));
  if(!line)throw Error("cookie missing: "+name+" from "+header);
  return line.split(";")[0];
}
test("OAuth config denies missing allowlist and weak secret",()=>{
  assert.equal(githubOAuthConfigured({...env,OSA_GITHUB_ALLOWED_USER_IDS:""}),false);
  assert.equal(githubOAuthConfigured({...env,OSA_GITHUB_SESSION_SECRET:"weak"}),false);
  assert.equal(githubOAuthConfigured(env),true);
});
test("GitHub preview OAuth: PKCE, signed state, stable broker callback, signed HttpOnly session",async()=>{
  await serve(async()=>new Response(JSON.stringify({id:123456,login:"verified-operator"}),{status:200}),
    async base=>{
      const start=await localFetch(base+"/auth/github/start?return_to=%2F",{headers:{host:preview},redirect:"manual"});
      assert.equal(start.status,302);
      const location=start.headers.get("location")!;
      const authUrl=new URL(location);
      assert.equal(authUrl.hostname,"github.com");
      assert.equal(authUrl.searchParams.get("redirect_uri"),env.OSA_GITHUB_CALLBACK_ORIGIN+"/api/auth/github/callback");
      assert.equal(authUrl.searchParams.get("code_challenge_method"),"S256");
      const state=authUrl.searchParams.get("state")!;
      const pending=parseCookie(start.headers.get("set-cookie"),"__Host-osa_oauth");
      assert.match(start.headers.get("set-cookie")??"",/HttpOnly; Secure; SameSite=None/);
      const callback=await localFetch(base+"/auth/github/callback?code=testCode123&state="+encodeURIComponent(state),
        {headers:{host:"osa-proof-three.vercel.app"},redirect:"manual"});
      assert.equal(callback.status,200);
      const html=await callback.text();
      assert.match(html,/method="POST"/);
      assert.match(html,/osa-proof-git-feature-x\.vercel\.app\/api\/auth\/github\/complete/);
      assert.equal(html.includes("transient-test-token"),false);
      const body=new URLSearchParams({code:"testCode123",state});
      const complete=await localFetch(base+"/auth/github/complete",{method:"POST",headers:{
        host:preview,"content-type":"application/x-www-form-urlencoded","cookie":pending,
      },body:body.toString(),redirect:"manual"});
      assert.equal(complete.status,302);
      assert.equal(complete.headers.get("location"),"/");
      const session=parseCookie(complete.headers.get("set-cookie"),"__Host-osa_session");
      assert.match(complete.headers.get("set-cookie")??"",/HttpOnly; Secure; SameSite=Lax/);
      const req={headers:{cookie:session}} as IncomingMessage;
      const result=readGithubSession(req,env);
      assert.equal(result?.identity.provider,"github");
      assert.equal(result?.identity.subject,"123456");
      assert.equal(result?.identity.organization_id,"org_test");
      assert.equal(result?.identity.project_ids?.[0],"project_test");
      assert.equal(result?.token,"");
      assert.equal(readGithubSession({headers:{cookie:session+"corrupt"}} as IncomingMessage,env),undefined);
      const replay=await localFetch(base+"/auth/github/complete",{method:"POST",headers:{host:preview,"content-type":"application/x-www-form-urlencoded"},
        body:body.toString(),redirect:"manual"});
      assert.equal(replay.status,400);
    });
});
test("GitHub preview OAuth: disallows unauthorized GitHub identities",async()=>{
  await serve(async()=>new Response(JSON.stringify({id:222333,login:"not-allowed"}),{status:200}),
    async base=>{
      const begin=await localFetch(base+"/auth/github/start",{headers:{host:preview},redirect:"manual"});
      const state=new URL(begin.headers.get("location")!).searchParams.get("state")!;
      const pending=parseCookie(begin.headers.get("set-cookie"),"__Host-osa_oauth");
      const done=await localFetch(base+"/auth/github/complete",{method:"POST",headers:{
        host:preview,cookie:pending,"content-type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({code:"valid_code",state}).toString(),redirect:"manual"});
      assert.equal(done.status,403);
      assert.equal((await done.json() as {code:string}).code,"OAUTH_USER_NOT_ALLOWED");
      assert.equal((done.headers.get("set-cookie")??"").includes("__Host-osa_session"),false);
    });
});
test("GitHub preview OAuth: untrusted preview host cannot initiate login",async()=>{
  await serve(async()=>new Response(JSON.stringify({id:123456,login:"user"}),{status:200}),
    async base=>{
      const r=await localFetch(base+"/auth/github/start",{headers:{host:"attacker.example.org"},redirect:"manual"});
      assert.equal(r.status,400);
      assert.equal((r.headers.get("location")??""), "");
    });
});
