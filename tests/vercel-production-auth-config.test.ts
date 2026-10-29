import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {loadAuthMode} from "../apps/api/src/index";
import {publicProviderStatus} from "../apps/api/src/social-auth";

test("Vercel deployment config must never override production session auth with open",()=>{
  const config=JSON.parse(readFileSync(resolve(process.cwd(),"vercel.json"),"utf8")) as {
    env?:Record<string,string>;
  };
  assert.equal(Object.hasOwn(config.env??{},"OSA_AUTH_MODE"),false,
    "Set preview mode only in Vercel Preview variables; production has independent session config");
});

test("session production Google OAuth is enabled only with configured credentials",()=>{
  const env={
    OSA_PUBLIC_AUTH_ENABLED:"enabled",OSA_AUTH_MODE:"session",
    OSA_PUBLIC_AUTH_ORIGIN:"https://osa-proof-three.vercel.app",
    OSA_PUBLIC_SESSION_SECRET:"local-test-only-signed-session-key-123456789",
    OSA_PUBLIC_GOOGLE_CLIENT_ID:"valid-test-google-id",
    OSA_PUBLIC_GOOGLE_CLIENT_SECRET:"test-only-google-secret",
  };
  assert.equal(loadAuthMode(env),"session");
  assert.equal(publicProviderStatus(env).google,true);
  assert.equal(publicProviderStatus({...env,OSA_AUTH_MODE:"open"}).google,false);
  assert.equal(publicProviderStatus({...env,OSA_PUBLIC_GOOGLE_CLIENT_SECRET:""}).google,false);
  assert.equal(publicProviderStatus({...env,OSA_PUBLIC_SESSION_SECRET:"short"}).google,false);
});
