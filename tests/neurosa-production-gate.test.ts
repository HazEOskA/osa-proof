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
