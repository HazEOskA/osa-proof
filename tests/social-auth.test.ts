import assert from "node:assert/strict";
import test from "node:test";
import {createHmac, createSign, generateKeyPairSync} from "node:crypto";
import {createServer,request as httpRequest,type IncomingMessage} from "node:http";
import {handleSocialAuth,publicProviderStatus,readSocialSession} from "../apps/api/src/social-auth";

const HOST="osa-proof-three.vercel.app";
const env={
  OSA_PUBLIC_AUTH_ENABLED:"enabled", OSA_AUTH_MODE:"session", OSA_PUBLIC_AUTH_ORIGIN:"https://"+HOST,
  OSA_PUBLIC_SESSION_SECRET:"unit-tests-social-secret-sufficiently-long",
  OSA_PUBLIC_GITHUB_CLIENT_ID:"test-social-github",OSA_PUBLIC_GITHUB_CLIENT_SECRET:"test-github-only",
  OSA_PUBLIC_GOOGLE_CLIENT_ID:"test-social-google",OSA_PUBLIC_GOOGLE_CLIENT_SECRET:"test-google-only",
  OSA_GITHUB_ALLOWED_USER_IDS:"123456", OSA_NEUROSA_ORGANIZATION_ID:"org-owner",
  OSA_NEUROSA_PROJECT_ID:"project-owner",
};
const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk=rsa.publicKey.export({format:"jwk"}) as Record<string,unknown>;
const signedIdToken=(nonce:string,sub:string)=>{
  const header=Buffer.from(JSON.stringify({alg:"RS256",kid:"test-kid",typ:"JWT"})).toString("base64url");
  const payload=Buffer.from(JSON.stringify({iss:"https://accounts.google.com",aud:env.OSA_PUBLIC_GOOGLE_CLIENT_ID,
    sub,nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,
    name:"Google Tester",email:"test@example.com",email_verified:true})).toString("base64url");
  const signature=createSign("RSA-SHA256").update(header+"."+payload).sign(rsa.privateKey).toString("base64url");
  return header+"."+payload+"."+signature;
};
async function localFetch(url:string, init:RequestInit={}):Promise<Response>{
  return new Promise((resolve,reject)=>{
    const req=httpRequest(url,{method:init.method??"GET",headers:Object.fromEntries(new Headers(init.headers).entries())},res=>{
      const chunks:Buffer[]=[];
      res.on("data",chunk=>chunks.push(Buffer.from(chunk)));
      res.on("end",()=>{
        const headers=new Headers();
        for(const [k,v] of Object.entries(res.headers)){
          if(typeof v==="string")headers.set(k,v);
          else if(Array.isArray(v))for(const item of v)headers.append(k,item);
        }
        resolve(new Response(Buffer.concat(chunks),{status:res.statusCode??500,headers}));
      });res.on("error",reject);
    });
    req.on("error",reject);req.end(init.body as string|undefined);
  });
}
function cookie(res:Response,key:string){
  const match=(res.headers.get("set-cookie")??"").match(new RegExp(key+"=[^;]+"));
  assert.ok(match,"expected "+key+" cookie");return match[0];
}
async function withServer(provider:"google"|"github",sub:string,action:(base:string)=>Promise<void>,authorizationCode="test_code",rejectCode=false) {
  let googleNonce="";
  let exchanges=0;
  const srv=createServer(async(req,res)=>{
    const handled=await handleSocialAuth(req,res,env,async(input,init)=>{
      const url=String(input);
      if(url==="https://oauth2.googleapis.com/token"){
        exchanges++;
        const body=new URLSearchParams(String(init?.body));
        assert.equal(body.get("client_secret"),env.OSA_PUBLIC_GOOGLE_CLIENT_SECRET);
        assert.equal(body.get("code"),authorizationCode);
        assert.match(body.get("code_verifier")??"",/^[A-Za-z0-9_-]{43,128}$/);
        return Response.json({access_token:"google-test",id_token:signedIdToken(googleNonce,sub)});
      }
      if(url==="https://github.com/login/oauth/access_token"){
        exchanges++;
        const body=new URLSearchParams(String(init?.body));
        assert.equal(body.get("client_secret"),env.OSA_PUBLIC_GITHUB_CLIENT_SECRET);
        assert.equal(body.get("code"),authorizationCode);
        assert.match(body.get("code_verifier")??"",/^[A-Za-z0-9_-]{43,128}$/);
        return Response.json({access_token:"github-test"});
      }
      if(url==="https://api.github.com/user"){
        assert.equal(new Headers(init?.headers).get("authorization"),"Bearer github-test");
        return Response.json({id:Number(sub),login:"test-github-user"});
      }
      if(url==="https://www.googleapis.com/oauth2/v3/certs"){
        return Response.json({keys:[{...jwk,kid:"test-kid",use:"sig",alg:"RS256"}]});
      }
      throw Error("unexpected outbound "+url);
    });
    if(!handled){res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>srv.listen(0,"127.0.0.1",resolve));
  try{
    const addr=srv.address();if(!addr||typeof addr==="string")throw Error("listener");
    const base="http://127.0.0.1:"+addr.port;
    const begin=await localFetch(base+"/auth/social/"+provider+"/start?return_to=%2F",{headers:{host:HOST}});
    assert.equal(begin.status,302);
    const loc=new URL(begin.headers.get("location")??"");
    assert.equal(loc.searchParams.get("code_challenge_method"),"S256");
    googleNonce=loc.searchParams.get("nonce")??"";
    assert.equal(loc.searchParams.get("redirect_uri"),
      "https://"+HOST+(provider==="github"?"/api/auth/github/callback":"/api/auth/social/google/callback"));
    const state=loc.searchParams.get("state")!;
    const originalCookie=cookie(begin,"__Host-osa_social_oauth");
    const callbackPath=provider==="github"?"/auth/github/callback":"/auth/social/google/callback";
    const callback=await localFetch(base+callbackPath+"?code="+encodeURIComponent(authorizationCode)+"&state="+encodeURIComponent(state),
      {headers:{host:HOST,cookie:originalCookie},redirect:"manual"});
    if(rejectCode){
      assert.equal(callback.status,400);
      assert.equal(exchanges,0,"malformed authorization code must not reach token exchange");
      return;
    }
    assert.equal(callback.status,302);
    assert.equal(callback.headers.get("location"),"/");
    const sessionCookie=cookie(callback,"__Host-osa_social_session");
    const req={headers:{cookie:sessionCookie}} as IncomingMessage;
    const session=readSocialSession(req,env);
    assert.equal(session?.identity.provider,provider);
    assert.equal(session?.identity.subject,sub);
    assert.equal(session?.token,"");
    assert.equal(readSocialSession({headers:{cookie:sessionCookie+"tamper"}} as IncomingMessage,env),undefined);
    await action(base);
    const replay=await localFetch(base+callbackPath+"?code=test_code&state="+encodeURIComponent(state),
      {headers:{host:HOST},redirect:"manual"});
    assert.equal(replay.status,400);
  }finally{await new Promise<void>(resolve=>srv.close(()=>resolve()));}
}
test("public sign-in is disabled for open auth and missing credentials",()=>{
  assert.deepEqual(publicProviderStatus({...env,OSA_AUTH_MODE:"open"}),{google:false,github:false});
  assert.deepEqual(publicProviderStatus({...env,OSA_PUBLIC_GOOGLE_CLIENT_SECRET:""}),{google:false,github:true});
  assert.deepEqual(publicProviderStatus(env),{google:true,github:true});
});
test("GitHub social OAuth authenticates ordinary visitor without owner memory tenant",async()=>{
  await withServer("github","777888",async()=>{});
});
test("Google OIDC validates RS256 JWT and establishes ordinary visitor",async()=>{
  await withServer("google","google-user-44",async()=>{});
});
test("Google OAuth accepts valid slash-containing opaque codes and exchanges the exact value",async()=>{
  await withServer("google","google-user-55",async()=>{},"4/P7q7W91a-oMsCeLvIaQm6bTrgtp7");
});
test("Google OAuth rejects control characters and overlong codes before token exchange",async()=>{
  await withServer("google","google-user-bad",async()=>{},"4/P7q\nmalformed",true);
  await withServer("google","google-user-bad",async()=>{},"4/"+("a".repeat(502)),true);
});
test("owner mapping requires server-verified GitHub numeric id",()=>{
  const signed=Buffer.from(JSON.stringify({kind:"osa.social.v1",provider:"github",sub:"123456",name:"owner",
    nonce:"abcdefghijklmnopqrstuvwxyz123456",iat:Date.now(),exp:Date.now()+100000})).toString("base64url");
  const mac=createHmac("sha256",env.OSA_PUBLIC_SESSION_SECRET).update(signed).digest("base64url");
  const req={headers:{cookie:"__Host-osa_social_session="+signed+"."+mac}} as IncomingMessage;
  const s=readSocialSession(req,env);
  assert.deepEqual(s?.identity.roles,["owner","operator"]);
  assert.equal(s?.identity.organization_id,"org-owner");
  assert.equal(s?.identity.project_ids?.[0],"project-owner");
  const visitorReq={headers:{cookie:"__Host-osa_social_session="+
    Buffer.from(JSON.stringify({kind:"osa.social.v1",provider:"google",sub:"stranger",name:"stranger",
      nonce:"abcdefghijklmnopqrstuvwxyz123456",iat:Date.now(),exp:Date.now()+100000})).toString("base64url")
    }} as IncomingMessage;
  assert.equal(readSocialSession(visitorReq,env),undefined);
});

test("Google owner is granted private memory tenant only by verified-subject allowlist",()=>{
  const now=Date.now();
  const subject="owner-google-sub-123";
  const ownerEnv={...env,OSA_GOOGLE_OWNER_SUBJECTS:subject};
  const sessionClaims={kind:"osa.social.v1",provider:"google",sub:subject,name:"Owner Google",
    nonce:"abcdefghijklmnopqrstuvwxyz123456",iat:now,exp:now+100000};
  const data=Buffer.from(JSON.stringify(sessionClaims)).toString("base64url");
  const signature=createHmac("sha256",ownerEnv.OSA_PUBLIC_SESSION_SECRET).update(data).digest("base64url");
  const cookieHeader="__Host-osa_social_session="+data+"."+signature;
  const request={headers:{cookie:cookieHeader}} as IncomingMessage;
  const owner=readSocialSession(request,ownerEnv);
  assert.deepEqual(owner?.identity.roles,["owner","operator"]);
  assert.equal(owner?.identity.provider,"google");
  assert.equal(owner?.identity.organization_id,"org-owner");
  assert.deepEqual(owner?.identity.project_ids,["project-owner"]);
  const guest=readSocialSession(request,{...ownerEnv,OSA_GOOGLE_OWNER_SUBJECTS:""});
  assert.deepEqual(guest?.identity.roles,["visitor"]);
  assert.equal(guest?.identity.organization_id,undefined);
  assert.equal(guest?.identity.project_ids,undefined);
  const forged=readSocialSession({headers:{cookie:cookieHeader+"tampered"}} as IncomingMessage,ownerEnv);
  assert.equal(forged,undefined);
});
