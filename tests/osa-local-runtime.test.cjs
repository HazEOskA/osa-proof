"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalHandler } = require("../bin/osa.cjs");

test("OSA Local: jednorazowy bilet, UI, API i CSRF", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osa-local-test-"));
  await fs.writeFile(path.join(root, "index.html"), "OSA OK");
  const options = { port: 0, staticRoot: root, ticket: "test-ticket", cookie: "a".repeat(64), used: false };
  let apiCalls = 0;
  const handler = createLocalHandler(options, async(req, res) => {
    apiCalls++;
    res.writeHead(200);
    res.end(req.url);
  });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  options.port = server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${options.port}`;
  assert.equal((await fetch(base + "/api/build/status")).status, 403);
  const first = await fetch(base + "/__open?ticket=test-ticket", { redirect: "manual" });
  assert.equal(first.status, 302);
  assert.match(first.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const cookie = first.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(base + "/__open?ticket=test-ticket", { redirect: "manual" })).status, 403);
  const page = await fetch(base + "/", { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.equal(await page.text(), "OSA OK");
  const api = await fetch(base + "/api/build/status", { headers: { cookie } });
  assert.equal(await api.text(), "/build/status");
  const badOrigin = await fetch(base + "/api/teams", {
    method: "POST", headers: { cookie, origin: "https://evil.invalid" }, body: "{}"
  });
  assert.equal(badOrigin.status, 403);
  assert.equal(apiCalls, 1);
  const missingOrigin = await fetch(base + "/api/teams", {
    method: "POST", headers: { cookie }, body: "{}"
  });
  assert.equal(missingOrigin.status, 403);
  const crossSite = await fetch(base + "/api/teams", {
    method: "POST", headers: { cookie, origin: base, "sec-fetch-site": "cross-site" }, body: "{}"
  });
  assert.equal(crossSite.status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: options.port, path: "/", headers: { cookie, Host: "localhost:" + options.port } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });
  assert.equal(wrongHost, 403);
  const outside = await fetch(base + "/%2e%2e/%2e%2e/PRIVATE", { headers: { cookie } });
  assert.equal(outside.status, 404);
});

test("OSA Local: wymaga jawnego polecenia dashboard", async t => {
  const original = process.exitCode;
  const oldLog = console.error;
  console.error = () => {};
  t.after(() => { process.exitCode = original; console.error = oldLog; });
  await require("../bin/osa.cjs").main(["unknown"]);
  assert.equal(process.exitCode, 2);
});

const { dockerPreflight, localPaths, localExecutionEnv, buildFiles, buildMissing, startDashboard } = require("../bin/osa.cjs");

test("OSA P0: Docker preflight fails closed, no auto-install or image pull", () => {
  const calls = [];
  const noDocker = (cmd, args, opts) => { calls.push(args.join(" ")); assert.equal(opts.shell, false); return { error: new Error("missing"), status: null }; };
  assert.equal(dockerPreflight({}, noDocker), "DOCKER_UNAVAILABLE");
  assert.deepEqual(calls, ["info --format {{.ServerVersion}}"]) ;
  const missingImage = (cmd, args) => args[0] === "info" ? { status: 0 } : { status: 1 };
  assert.equal(dockerPreflight({}, missingImage), "IMAGE_NOT_BUILT");
  const ready = (cmd, args) => ({ status: 0 });
  assert.equal(dockerPreflight({ OSA_WORKSPACE_DOCKER_IMAGE: "osa/workspace-node22:v0.1" }, ready), "SANDBOX_PREFLIGHT_PASS");
});

test("OSA P0: env default is fixture and side-effect integrations remain off", () => {
  const paths = localPaths({ LOCALAPPDATA: path.join("C:", "Users", "test", "AppData", "Local") }, "home");
  assert.equal(paths.missions, path.join(paths.data, "missions"));
  assert.equal(paths.durable, path.join(paths.data, "durable"));
  const blocked = localExecutionEnv({ OSA_EXECUTION_MODE: "provider", OSA_INTEGRATION_ENABLED: "1", OSA_NATIVE_BUILDER_EXECUTION: "enabled" }, paths);
  assert.equal(blocked.OSA_EXECUTION_MODE, "fixture");
  assert.equal(blocked.OSA_INTEGRATION_ENABLED, "0");
  assert.equal(blocked.OSA_NATIVE_BUILDER_EXECUTION, "disabled");
  assert.equal(blocked.OSA_ZERO_COST_ONLY, "true");
  assert.equal(blocked.OSA_WORKER_BASE_URL, "");
  assert.equal(blocked.OSA_WORKER_TOKEN, "");
  assert.equal(blocked.OSA_WORKSPACE_PROVIDER, "docker");
  assert.equal(blocked.OSA_NEUROSA_BASE_URL, "");
  const allowed = localExecutionEnv({ OSA_EXECUTION_MODE: "provider", OSA_LOCAL_PROVIDER_ENABLED: "true" }, paths);
  assert.equal(allowed.OSA_EXECUTION_MODE, "provider");
  assert.equal(allowed.OSA_INTEGRATION_ENABLED, "0");
});

test("OSA P0: health is protected, dynamic, and never reports Docker readiness by assumption", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osa-health-"));
  await fs.writeFile(path.join(root, "index.html"), "OK");
  const options = { port: 0, staticRoot: root, ticket: "one-time", cookie: "b".repeat(64), used: false,
    health: async () => ({ schema: "osa.local_host_health.v1", durable_worker: "BLOCKED", sandbox: "DOCKER_UNAVAILABLE" }) };
  const server = http.createServer((req,res)=>void createLocalHandler(options,async()=>{})(req,res));
  await new Promise(resolve=>server.listen(0, "127.0.0.1", resolve));
  options.port = server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${options.port}`;
  assert.equal((await fetch(base + "/__health")).status, 403);
  const token=(await fetch(base + "/__open?ticket=one-time",{redirect:"manual"})).headers.get("set-cookie").split(";")[0];
  const result=await fetch(base + "/__health",{headers:{cookie:token}});
  assert.equal(result.status,200);
  const json=await result.json();
  assert.equal(json.schema,"osa.local_host_health.v1");
  assert.equal(json.durable_worker,"BLOCKED");
  assert.equal(json.sandbox,"DOCKER_UNAVAILABLE");
  assert.equal((await fetch(base + "/__health",{method:"POST",headers:{cookie:token,origin:base}})).status,405);
});

test("OSA P0: HTTP host start/stop/restart retains persisted mission directory (isolated stub harness)", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"osa-host-restart-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const files=buildFiles(root);
  for(const f of [path.join(files.staticRoot,"index.html"),files.api,files.server,files.durableWorker,
                  files.missionStore,files.durableStore,files.web3])await fs.mkdir(path.dirname(f),{recursive:true});
  await fs.writeFile(path.join(files.staticRoot,"index.html"),"OSA TEST UI");
  await fs.writeFile(files.api,`class ApiState {}\nexports.ApiState=ApiState; exports.handleApiRequest=async(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({path:req.url}))}`);
  await fs.writeFile(files.server,`exports.createDevExecution=()=>({mode:'fixture',registry:{},brain:{},description:{mode:'fixture'}})`);
  await fs.writeFile(files.missionStore,`exports.FileMissionStore=class {constructor(dir){this.root=dir}}`);
  await fs.writeFile(files.durableStore,`exports.FileDurableJobStore=class {async workerHealthy(){return false}}`);
  await fs.writeFile(files.web3,`exports.createConfiguredWeb3=()=>({})`);
  await fs.writeFile(files.durableWorker,`// not started without a provider`);
  assert.deepEqual(buildMissing(files), []);
  // Find a free loopback port; the actual P0 server must bind that exact interface.
  const reserve=http.createServer();
  await new Promise(resolve=>reserve.listen(0,"127.0.0.1",resolve));
  const port=reserve.address().port;
  await new Promise(resolve=>reserve.close(resolve));
  const variables=["OSA_LOCAL_PORT","LOCALAPPDATA","OSA_EXECUTION_MODE","OSA_LOCAL_PROVIDER_ENABLED",
    "OSA_AUTH_MODE","OSA_INTEGRATION_ENABLED","OSA_ZERO_COST_ONLY","OSA_NATIVE_BUILDER_EXECUTION",
    "OSA_DURABLE_DIR","OSA_MISSION_STORE_DIR","NVIDIA_API_KEY","OSA_NVIDIA_FREE_TIER_ACK","VERCEL",
    "OSA_WORKER_BASE_URL","OSA_WORKER_TOKEN","OSA_WORKSPACE_PROVIDER","OSA_NEUROSA_BASE_URL",
    "OSA_NEUROSA_TOKEN","OSA_NEUROSA_BRAIN_ID","OSA_NEUROSA_ORGANIZATION_ID","OSA_NEUROSA_PROJECT_ID"];
  const backup=Object.fromEntries(variables.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of variables){if(backup[k]===undefined)delete process.env[k];else process.env[k]=backup[k]}});
  process.env.OSA_LOCAL_PORT=String(port);
  process.env.LOCALAPPDATA=path.join(root,"local-appdata");
  delete process.env.NVIDIA_API_KEY;
  delete process.env.OSA_NVIDIA_FREE_TIER_ACK;
  delete process.env.OSA_LOCAL_PROVIDER_ENABLED;
  const first=await startDashboard({root,noBrowser:true});
  const base=`http://127.0.0.1:${port}`;
  const grant=await fetch(base+"/__open?ticket="+first.config.ticket,{redirect:"manual"});
  const cookie=grant.headers.get("set-cookie").split(";")[0];
  const health=await (await fetch(base+"/__health",{headers:{cookie}})).json();
  assert.equal(health.host,"READY_LOOPBACK");
  assert.equal(health.execution_mode,"fixture");
  assert.equal(health.durable_worker,"BLOCKED");
  assert.equal(health.persistence,"LOCAL_MISSION_AND_DURABLE_FILES");
  assert.equal((await fetch(base+"/api/build/status",{headers:{cookie}})).status,200);
  const sentinel=path.join(first.dirs.missions,"persisted-mission-record");
  await fs.writeFile(sentinel,"retained-on-disk");
  let closed=new Promise(resolve=>first.server.once("close",resolve));
  first.shutdown();await closed;
  const second=await startDashboard({root,noBrowser:true});
  assert.equal(second.dirs.missions,first.dirs.missions);
  assert.equal(await fs.readFile(sentinel,"utf8"),"retained-on-disk");
  closed=new Promise(resolve=>second.server.once("close",resolve));
  second.shutdown();await closed;
});
