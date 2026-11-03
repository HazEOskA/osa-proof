import { FileDurableJobStore } from "../../../packages/durable-execution/src";
import { runDurableWorkerOnce } from "./durable-executor";

// Dedicated long-running worker. Must share a PERSISTENT volume with the API.
// Never start in a Vercel Lambda: idle tasks are not guaranteed to execute there.
export async function startDurableWorker(env:NodeJS.ProcessEnv=process.env):Promise<never> {
  if(env.VERCEL==="1"||!env.OSA_DURABLE_DIR)throw Error("DURABLE_WORKER_PERSISTENT_DIR_REQUIRED");
  const store=new FileDurableJobStore(env.OSA_DURABLE_DIR);
  for(;;) {
    await runDurableWorkerOnce(store,{env});
    await new Promise(resolve=>setTimeout(resolve,750));
  }
}
if(require.main===module) {
  startDurableWorker().catch(()=>{process.stderr.write("DURABLE_WORKER_UNAVAILABLE\n");process.exitCode=1;});
}
