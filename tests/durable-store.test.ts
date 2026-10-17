import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { DurableStore, StorageError } from "../apps/api/src/durable-store";

function setup(){const pair=generateKeyPairSync("ed25519");return {pair,env:{OSA_STORAGE_URL:"https://project.supabase.co/functions/v1/osa-proof-storage",OSA_STORAGE_NAMESPACE:"test",OSA_STORAGE_PRIVATE_KEY_B64:pair.privateKey.export({format:"der",type:"pkcs8"}).toString("base64")}};}
test("trwały transport: podpis wiąże treść, namespace i scope bez przesyłania klucza prywatnego (kontrolowany HTTP)",async()=>{
  const {pair,env}=setup();let calls=0;
  const fetcher=(async(_url,options)=>{
    calls++;const body=String(options?.body),headers=options?.headers as Record<string,string>;
    assert.ok(verify(null,Buffer.from(body),pair.publicKey,Buffer.from(headers["x-osa-signature"],"base64")));
    const p=JSON.parse(body);assert.equal(p.namespace,"test");assert.equal(p.scope,"org:project");assert.equal(p.expected_revision,2);
    assert.ok(!body.includes(env.OSA_STORAGE_PRIVATE_KEY_B64));assert.equal(options?.redirect,"error");
    return Response.json({record:{record_id:p.record_id,revision:3,payload:p.payload}});
  }) as typeof fetch;
  const saved=await new DurableStore(env,fetcher).put("org:project","missions","id",{value:"contract"},2);
  assert.equal(saved.revision,3);assert.equal(calls,1);
});
test("trwały transport: konflikt i awaria nie zamieniają się w sukces ani pamięć procesu",async()=>{
  const {env}=setup();for(const status of [409,403,503]){
    const store=new DurableStore(env,(async()=>new Response("rejected",{status})) as typeof fetch);
    await assert.rejects(store.put("org:project","missions","id",{}),e=>e instanceof StorageError&&e.status===(status===409?409:503));
  }
});
test("trwały transport: błędny endpoint i nadmiarowy rekord są odrzucane przed siecią",async()=>{
  const {env}=setup();let calls=0;const fetcher=(async()=>{calls++;return Response.json({});}) as typeof fetch;
  for(const url of ["http://localhost/functions/v1/osa-proof-storage","https://project.supabase.co.attacker.invalid/functions/v1/osa-proof-storage","https://project.supabase.co/functions/v1/osa-proof-storage?token=x"]){
    await assert.rejects(new DurableStore({...env,OSA_STORAGE_URL:url},fetcher).get("org:project","missions","id"));
  }
  await assert.rejects(new DurableStore(env,fetcher).put("org:project","missions","id",{text:"x".repeat(520000)}));assert.equal(calls,0);
});
