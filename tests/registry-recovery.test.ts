import test from "node:test";
import assert from "node:assert/strict";
import { rebroadcastRegistryIntent } from "../packages/web3/src/solana/proof-registry";
import { FileDurableJobStore, type DurableJob } from "../packages/durable-execution/src";

const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
async function signedIntent() {
  const k = await (new Function("return import('@solana/kit')") as () => Promise<any>)();
  const signer = await k.generateKeyPairSigner();
  const message = k.pipe(k.createTransactionMessage({version:"legacy"}),
    (tx:any) => k.setTransactionMessageFeePayerSigner(signer,tx),
    (tx:any) => k.setTransactionMessageLifetimeUsingBlockhash({blockhash:k.blockhash("11111111111111111111111111111111"),lastValidBlockHeight:100n},tx),
    (tx:any) => k.appendTransactionMessageInstructions([{programAddress:k.address("11111111111111111111111111111111"),accounts:[],data:new Uint8Array([1])}],tx));
  const transaction = await k.signTransactionMessageWithSigners(message);
  return {transactionSignature:String(k.getSignatureFromTransaction(transaction)),lastValidBlockHeight:"100",wireTransactionBase64:String(k.getBase64EncodedWireTransaction(transaction))};
}
function rpc(height:number, calls:any[]) {
  return (async (_url:any,init:any) => {
    const req=JSON.parse(init.body); calls.push(req);
    const result=req.method==="getGenesisHash"?genesis:req.method==="getBlockHeight"?height:"accepted";
    return Response.json({jsonrpc:"2.0",id:1,result});
  }) as typeof fetch;
}

test("recovery broadcasts exactly the persisted signed bytes before expiry",async()=>{
  const intent=await signedIntent(); const calls:any[]=[];
  await rebroadcastRegistryIntent(intent,rpc(99,calls));
  assert.deepEqual(calls.map(c=>c.method),["getGenesisHash","getBlockHeight","sendTransaction"]);
  assert.equal(calls[2].params[0],intent.wireTransactionBase64);
});

test("expired, missing, changed signature and offline requests never broadcast",async()=>{
  const intent=await signedIntent();
  for(const [value,height] of [[intent,101],[{...intent,wireTransactionBase64:undefined},99],[{...intent,transactionSignature:"wrong"},99]] as const){
    const calls:any[]=[]; await rebroadcastRegistryIntent(value,rpc(height,calls));
    assert.equal(calls.some(c=>c.method==="sendTransaction"),false);
  }
  await assert.doesNotReject(rebroadcastRegistryIntent(intent,(async()=>{throw Error("offline")}) as typeof fetch));
});

test("public status never exposes signed transaction bytes",async()=>{
  const store=new FileDurableJobStore("unused-test-directory");
  const job={schema:"osa.durable_job.v1",input:{execution_id:"exec_00000000-0000-4000-8000-000000000000",conversation_id:"00000000-0000-4000-8000-000000000000",kind:"model"},status:"COMPLETED",created_at:"2026-01-01",updated_at:"2026-01-01",registry_anchor:{status:"PENDING",network:"devnet",programId:"program",merkleRoot:"root",transactionSignature:"sig",wireTransactionBase64:"private"}} as unknown as DurableJob;
  const result=await store.publicStatus(job);
  assert.equal(JSON.stringify(result).includes("wireTransactionBase64"),false);
  assert.equal(JSON.stringify(result).includes("private"),false);
});