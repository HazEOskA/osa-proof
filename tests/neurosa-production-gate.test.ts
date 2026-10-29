import assert from "node:assert/strict";
import test from "node:test";
import { isNeurosaAuthenticatedProduction } from "../api/osa";

const origin="osa-proof-three.vercel.app";
function config():Record<string,string>{
  return {
    VERCEL:"1",VERCEL_ENV:"production",OSA_NEUROSA_PRODUCTION_ENABLED:"enabled",
    OSA_NEUROSA_STORAGE_VERIFIED:"true",OSA_AUTH_MODE:"session",
    OSA_GITHUB_CLIENT_ID:"test-client",OSA_GITHUB_CLIENT_SECRET:"test-only",
    OSA_GITHUB_SESSION_SECRET:"not-a-production-secret-123456789012345",
    OSA_GITHUB_ALLOWED_USER_IDS:"123456",OSA_GITHUB_CALLBACK_ORIGIN:"https://"+origin,
    OSA_GITHUB_ORGANIZATION_ID:"org-osa",OSA_GITHUB_PROJECT_ID:"project-osa",
    OSA_NEUROSA_ORGANIZATION_ID:"org-osa",OSA_NEUROSA_PROJECT_ID:"project-osa"
  };
}
test("NeurOSA production: only explicitly approved, authenticated, durable host is eligible",()=>{
  const env=config();
  assert.equal(isNeurosaAuthenticatedProduction(origin,env),true);
  assert.equal(isNeurosaAuthenticatedProduction(origin,env,origin),true);
  assert.equal(isNeurosaAuthenticatedProduction("agentworlds.dev",env),false);
  assert.equal(isNeurosaAuthenticatedProduction(origin,env,"agentworlds.dev"),false);
  assert.equal(isNeurosaAuthenticatedProduction(origin,{...env,VERCEL_ENV:"preview"}),false);
  assert.equal(isNeurosaAuthenticatedProduction(origin,{...env,OSA_NEUROSA_PRODUCTION_ENABLED:""}),false);
});
test("NeurOSA production: derives Github operator scope from pinned Brain tenant and rejects explicit mismatches",()=>{
  const env=config();
  delete env.OSA_GITHUB_ORGANIZATION_ID;
  delete env.OSA_GITHUB_PROJECT_ID;
  assert.equal(isNeurosaAuthenticatedProduction(origin,env),true);
  assert.throws(()=>isNeurosaAuthenticatedProduction(origin,{...env,OSA_GITHUB_ORGANIZATION_ID:"foreign"}),/NEUROSA_PRODUCTION_GATE_BLOCKED/);
  assert.throws(()=>isNeurosaAuthenticatedProduction(origin,{...env,OSA_GITHUB_PROJECT_ID:"foreign"}),/NEUROSA_PRODUCTION_GATE_BLOCKED/);
  assert.throws(()=>isNeurosaAuthenticatedProduction(origin,{...env,OSA_NEUROSA_PROJECT_ID:""}),/NEUROSA_PRODUCTION_GATE_BLOCKED/);
});
test("NeurOSA production: missing auth, unsafe open mode or storage proof fails closed",()=>{
  const base=config();
  for(const changed of [
    {OSA_AUTH_MODE:"open"},{OSA_NEUROSA_STORAGE_VERIFIED:""},
    {OSA_GITHUB_ALLOWED_USER_IDS:""},{OSA_GITHUB_SESSION_SECRET:"weak"},
    {OSA_GITHUB_PROJECT_ID:"foreign"},{OSA_GITHUB_ORGANIZATION_ID:"foreign"},
    {VERCEL:"0"},
  ]) {
    assert.throws(()=>isNeurosaAuthenticatedProduction(origin,{...base,...changed}),/NEUROSA_PRODUCTION_GATE_BLOCKED/);
  }
});

function googleOwnerConfig(): Record<string,string> {
  const env=config();
  delete env.OSA_GITHUB_CLIENT_ID;
  delete env.OSA_GITHUB_CLIENT_SECRET;
  delete env.OSA_GITHUB_SESSION_SECRET;
  delete env.OSA_GITHUB_ALLOWED_USER_IDS;
  delete env.OSA_GITHUB_CALLBACK_ORIGIN;
  return {
    ...env,
    OSA_PUBLIC_AUTH_ENABLED:"enabled",
    OSA_PUBLIC_AUTH_ORIGIN:"https://"+origin,
    OSA_PUBLIC_SESSION_SECRET:"google-owner-session-signing-secret-12345678",
    OSA_PUBLIC_GOOGLE_CLIENT_ID:"test-google-app",
    OSA_PUBLIC_GOOGLE_CLIENT_SECRET:"test-google-client-secret",
    OSA_GOOGLE_OWNER_SUBJECTS:"owner-google-sub-123",
  };
}
test("NeurOSA production: Google-only owner with verified sub and tenant is eligible",()=>{
  const env=googleOwnerConfig();
  assert.equal(isNeurosaAuthenticatedProduction(origin,env),true);
  assert.equal(isNeurosaAuthenticatedProduction(origin,env,origin),true);
  assert.equal(isNeurosaAuthenticatedProduction("agentworlds.dev",env),false);
  assert.equal(isNeurosaAuthenticatedProduction(origin,env,"agentworlds.dev"),false);
});
test("NeurOSA production: Google login alone never enables private memory",()=>{
  const base=googleOwnerConfig();
  for(const changed of [
    {OSA_GOOGLE_OWNER_SUBJECTS:""},
    {OSA_GOOGLE_OWNER_SUBJECTS:"not valid subject!"},
    {OSA_PUBLIC_AUTH_ENABLED:""},
    {OSA_PUBLIC_GOOGLE_CLIENT_SECRET:""},
    {OSA_PUBLIC_AUTH_ORIGIN:"https://agentworlds.dev"},
    {OSA_PUBLIC_SESSION_SECRET:"weak"},
    {OSA_AUTH_MODE:"open"},
    {OSA_NEUROSA_STORAGE_VERIFIED:""},
    {OSA_GITHUB_ORGANIZATION_ID:"foreign"},
    {OSA_GITHUB_PROJECT_ID:"foreign"},
  ]) assert.throws(()=>isNeurosaAuthenticatedProduction(origin,{...base,...changed}),/NEUROSA_PRODUCTION_GATE_BLOCKED/);
});
