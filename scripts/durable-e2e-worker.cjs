"use strict";
const {FileDurableJobStore}=require("../dist/packages/durable-execution/src");
const {runDurableWorkerOnce}=require("../dist/apps/worker/src/durable-executor");
const store=new FileDurableJobStore(process.env.OSA_DURABLE_DIR);
const source='<!doctype html><html lang="pl"><title>Durable E2E</title><body><h1>DURABLE ARTEFAKT GOTOWY</h1></body></html>';
const options={
  model:async(prompt)=>{await new Promise(r=>setTimeout(r,1050));return {provider:"NVIDIA",model:"controlled-test-only",provider_model:"controlled-test-only",text:"DURABLE MODEL ODZYSKANY: "+prompt,provider_response_id:"fixture",request_id:"fixture",request_sha256:"fixture",latency_ms:1050,finish_reason:"stop",status:"PROVIDER_RESPONSE"};},
  generate:async()=>{await new Promise(r=>setTimeout(r,1050));return {content:source,evidence:[{kind:"model_artifact_generation",data:{source:"CONTROLLED_TEST_GENERATOR",real_provider:false}}]};}
};
let alive=true;process.on("SIGTERM",()=>{alive=false;});
(async()=>{while(alive){await runDurableWorkerOnce(store,options);await new Promise(r=>setTimeout(r,120));}})().catch(e=>{console.error("DURABLE_WORKER_TEST_FAILED",e);process.exitCode=1;});
