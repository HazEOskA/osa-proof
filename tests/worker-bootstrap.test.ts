import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const helper = resolve("deploy/worker/config.sh");
function configure(file: string, values: Record<string,string>) {
  const env = {...process.env};
  for (const key of ["OSA_WORKER_TOKEN","OSA_WORKER_ORGANIZATION_ID","OSA_WORKER_PROJECT_ID","OSA_WORKSPACE_DOCKER_IMAGE","OSA_WORKSPACE_DOCKER_NETWORK"]) delete env[key];
  return spawnSync("bash",["-euc",'source "$1"; osa_worker_load_config "$2"; osa_worker_write_config "$2" worker.example.test',"worker-config",helper,file],{env:{...env,...values},encoding:"utf8"});
}
test("bootstrap: zapisuje wymagany scope, chroni token i zachowuje konfigurację przy ponowieniu",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"osa-worker-config-")),file=join(dir,"worker.env");
  const token=randomBytes(32).toString("hex");
  try {
    const first=configure(file,{OSA_WORKER_ORGANIZATION_ID:"org_test",OSA_WORKER_PROJECT_ID:"project_test",OSA_WORKER_TOKEN:token});
    assert.equal(first.status,0);assert.equal(first.stdout,"");assert.ok(!first.stderr.includes(token));
    const text=await readFile(file,"utf8");
    assert.match(text,/^OSA_WORKER_ORGANIZATION_ID=org_test$/m);assert.match(text,/^OSA_WORKER_PROJECT_ID=project_test$/m);
    assert.match(text,/^OSA_WORKSPACE_DOCKER_NETWORK=none$/m);assert.ok(text.includes("OSA_WORKER_TOKEN="+token));
    assert.equal((await stat(file)).mode&0o777,0o600);
    const again=configure(file,{});assert.equal(again.status,0);assert.ok((await readFile(file,"utf8"))===text);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("bootstrap: brak scope lub zły token zatrzymuje zapis i nie ujawnia wartości",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"osa-worker-config-")),file=join(dir,"worker.env");
  try {
    const missing=configure(file,{});assert.notEqual(missing.status,0);await assert.rejects(access(file));
    const token="invalid-"+randomBytes(6).toString("hex");
    const denied=configure(file,{OSA_WORKER_ORGANIZATION_ID:"org",OSA_WORKER_PROJECT_ID:"project",OSA_WORKER_TOKEN:token});
    assert.notEqual(denied.status,0);assert.ok(!denied.stdout.includes(token)&&!denied.stderr.includes(token));await assert.rejects(access(file));
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("bootstrap: istniejący env jest danymi, polecenie w tokenie nie jest wykonywane",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"osa-worker-config-")),file=join(dir,"worker.env"),marker=join(dir,"executed");
  try {
    const text=`OSA_WORKER_ORGANIZATION_ID=org\nOSA_WORKER_PROJECT_ID=project\nOSA_WORKER_TOKEN=$(touch ${marker})\n`;
    await writeFile(file,text,{mode:0o600});const result=configure(file,{});
    assert.notEqual(result.status,0);await assert.rejects(access(marker));assert.ok((await readFile(file,"utf8"))===text);
  } finally {await rm(dir,{recursive:true,force:true});}
});
