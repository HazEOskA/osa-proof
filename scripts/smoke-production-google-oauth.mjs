// Read-only production OAuth smoke. No real account, no secrets, no callback completion.
const origin="https://osa-proof-three.vercel.app";
const base=origin.replace(/\/$/,"");
const results={};
function check(cond,label){if(!cond)throw Error(label)}
async function get(path){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);try{return await fetch(base+path,{redirect:"manual",signal:controller.signal,headers:{"user-agent":"OSA-OAuth-Prod-Smoke/1.0","accept":"application/json"}})}finally{clearTimeout(timeout)}}
try {
 const status=await get("/api/auth/social/status");
 const body=await status.json().catch(()=>({}));
 const buildBefore=await get("/api/build/status");
 results.build_status_http_early=buildBefore.status;
 const buildBody=await buildBefore.json().catch(()=>({}));
 results.auth_mode_early=buildBody?.auth_mode??null;
 results.social_status_http=status.status;
 results.google_provider_enabled=body?.providers?.google===true;
 results.github_provider_enabled=body?.providers?.github===true;
 check(status.status===200,"SOCIAL_STATUS_NOT_200");
 check(results.google_provider_enabled,"GOOGLE_PROVIDER_DISABLED");
 const start=await get("/api/auth/social/google/start?return_to=%2F");
 const location=start.headers.get("location")??"";
 const redirect=location?new URL(location):null;
 results.google_start_http=start.status;
 results.google_redirect_host=redirect?.hostname??null;
 results.callback_path=redirect?.searchParams.get("redirect_uri")?new URL(redirect.searchParams.get("redirect_uri")).pathname:null;
 results.google_client_id_format=/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(redirect?.searchParams.get("client_id")??"");
 results.pkce_s256=redirect?.searchParams.get("code_challenge_method")==="S256";
 results.state_present=Boolean(redirect?.searchParams.get("state"));
 results.cookie_present=Boolean(start.headers.get("set-cookie")?.includes("__Host-osa_social_oauth="));
 check(start.status===302,"GOOGLE_START_NOT_302");
 check(redirect?.hostname==="accounts.google.com","GOOGLE_REDIRECT_HOST_MISMATCH");
 check(redirect?.searchParams.get("redirect_uri")===origin+"/api/auth/social/google/callback","GOOGLE_CALLBACK_MISMATCH");
 check(results.google_client_id_format,"GOOGLE_CLIENT_ID_FORMAT");
 check(results.pkce_s256&&results.state_present&&results.cookie_present,"GOOGLE_OAUTH_STATE_OR_PKCE_MISSING");
 const owner=await get("/api/auth/github/status");
 const ownerData=await owner.json().catch(()=>({}));
 results.owner_status_http=owner.status;
 results.owner_oauth_configured=ownerData?.configured===true;
 check(owner.status===200,"OWNER_STATUS_NOT_200");
 const build=await get("/api/build/status");
 results.build_status_http=build.status;
 const health=await build.json().catch(()=>({}));
 results.auth_mode=health?.auth_mode??null;
 check(build.status===200,"BUILD_STATUS_NOT_200");
 check(results.auth_mode==="session","AUTH_MODE_NOT_SESSION");
 console.log(JSON.stringify({verdict:"PASS",scope:"REAL_PRODUCTION_HTTP_OAUTH_REDIRECT_ONLY",...results},null,2));
} catch(error){
 console.error(JSON.stringify({verdict:"FAIL",reason:error instanceof Error?error.message:"UNKNOWN",...results},null,2));
 process.exitCode=1;
}
