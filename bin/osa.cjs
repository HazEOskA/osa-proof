#!/usr/bin/env node
"use strict";

// OSA P0: local single-operator host. No remote writes, no paid API on start.
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const IMAGE = "osa/workspace-node22:v0.1";
const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".ico": "image/x-icon"
});

function reject(res, status = 403) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end("ACCESS_DENIED");
}
function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}
function equalToken(received, expected) {
  return typeof received === "string" && received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
function createLocalHandler(options, api) {
  return async (req, res) => {
    const hostname = `127.0.0.1:${options.port}`;
    if (req.headers.host !== hostname) return reject(res);
    let url;
    try { url = new URL(req.url || "/", `http://${hostname}`); }
    catch { return reject(res, 400); }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");

    if (url.pathname === "/__open") {
      if (req.method !== "GET" || options.used ||
          !equalToken(url.searchParams.get("ticket"), options.ticket)) return reject(res);
      options.used = true;
      res.writeHead(302, {
        "Set-Cookie": `osa_local=${options.cookie}; Path=/; HttpOnly; SameSite=Strict`,
        "Location": "/"
      });
      res.end();
      return;
    }

    const cookie = req.headers.cookie?.split(";").map(s => s.trim())
      .find(s => s.startsWith("osa_local="))?.slice("osa_local=".length);
    if (!equalToken(cookie, options.cookie)) return reject(res);
    if (!["GET", "HEAD"].includes(req.method || "")) {
      if (req.headers.origin !== `http://${hostname}` || req.headers["sec-fetch-site"] === "cross-site")
        return reject(res);
    }

    if (url.pathname === "/__health") {
      if (req.method !== "GET") return reject(res, 405);
      try {
        const result = options.health ? await options.health() : { host: "HOST_READY", api: "UNKNOWN" };
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch { reject(res, 503); }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      req.url = url.pathname.slice(4) + url.search;
      try { await api(req, res); }
      catch { if (res.headersSent) res.destroy(); else reject(res, 500); }
      return;
    }

    if (!["GET", "HEAD"].includes(req.method || "")) return reject(res, 405);
    let requested;
    try { requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); }
    catch { return reject(res, 400); }
    if (requested.includes("\\") || requested.includes("\0")) return reject(res);
    const target = path.resolve(options.staticRoot, "." + requested);
    if (!isInside(options.staticRoot, target)) return reject(res);
    try {
      const real = await fsp.realpath(target);
      if (!isInside(options.staticRoot, real) || !(await fsp.stat(real)).isFile()) return reject(res, 404);
      const bytes = req.method === "HEAD" ? undefined : await fsp.readFile(real);
      res.writeHead(200, { "content-type": MIME[path.extname(real).toLowerCase()] || "application/octet-stream" });
      res.end(bytes);
    } catch { reject(res, 404); }
  };
}

// Existence of Docker + the local OSA image is a preflight, NOT proof of E2E execution.
function dockerPreflight(env = process.env, run = spawnSync) {
  const executable = env.DOCKER_BIN?.trim() || "docker";
  const base = { encoding: "utf8", windowsHide: true, timeout: 7000, shell: false };
  const daemon = run(executable, ["info", "--format", "{{.ServerVersion}}"], base);
  if (daemon.error || daemon.status !== 0) return "DOCKER_UNAVAILABLE";
  const image = env.OSA_WORKSPACE_DOCKER_IMAGE?.trim() || IMAGE;
  const inspect = run(executable, ["image", "inspect", image, "--format", "{{.Id}}"], base);
  return inspect.error || inspect.status !== 0 ? "IMAGE_NOT_BUILT" : "SANDBOX_PREFLIGHT_PASS";
}

function localPaths(env = process.env, homeDir = os.homedir()) {
  const home = env.LOCALAPPDATA?.trim() || path.join(homeDir, ".osa-proof");
  const data = path.join(home, "OSA-Proof");
  return Object.freeze({ data, durable: path.join(data, "durable"), missions: path.join(data, "missions") });
}
function localExecutionEnv(env, paths) {
  const providerEnabled = env.OSA_LOCAL_PROVIDER_ENABLED === "true";
  return {
    ...env,
    OSA_EXECUTION_MODE: providerEnabled && env.OSA_EXECUTION_MODE === "provider" ? "provider" : "fixture",
    OSA_INTEGRATION_ENABLED: "0", // Separate P1 permission gate: no external agent side effects.
    OSA_WORKER_BASE_URL: "", OSA_WORKER_TOKEN: "", OSA_WORKSPACE_PROVIDER: "docker",
    OSA_NEUROSA_BASE_URL: "", OSA_NEUROSA_TOKEN: "", OSA_NEUROSA_BRAIN_ID: "",
    OSA_NEUROSA_ORGANIZATION_ID: "", OSA_NEUROSA_PROJECT_ID: "",
    OSA_ZERO_COST_ONLY: "true",
    OSA_NATIVE_BUILDER_EXECUTION: "disabled",
    OSA_AUTH_MODE: "open", // Single operator, protected by loopback + local cookie gate.
    OSA_DURABLE_DIR: paths.durable,
    OSA_MISSION_STORE_DIR: paths.missions,
    VERCEL: ""
  };
}
function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "powershell.exe" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${url}'`]
    : [url];
  const proc = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: true });
  proc.on("error", () => console.error("[OSA] Nie można otworzyć przeglądarki; sprawdź lokalny adres w konsoli."));
  proc.unref();
}
function buildFiles(root = ROOT) {
  return {
    staticRoot: path.join(root, "dashboard-dist"),
    api: path.join(root, "dist/apps/api/src/index.js"),
    server: path.join(root, "dist/apps/api/src/server.js"),
    durableWorker: path.join(root, "dist/apps/worker/src/durable-runner.js"),
    missionStore: path.join(root, "dist/packages/runtime/src/index.js"),
    durableStore: path.join(root, "dist/packages/durable-execution/src/index.js"),
    web3: path.join(root, "dist/packages/web3/src/index.js")
  };
}
function buildMissing(files, exists = fs.existsSync) {
  return [path.join(files.staticRoot, "index.html"), files.api, files.server,
    files.durableWorker, files.missionStore, files.durableStore, files.web3].filter(f => !exists(f));
}

async function startDashboard(options = {}) {
  const files = buildFiles(options.root || ROOT);
  const missing = buildMissing(files);
  if (missing.length) throw Error("BRAK BUILD: npm run build && node scripts/build-dashboard.cjs");
  const port = Number(process.env.OSA_LOCAL_PORT || "3111");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("OSA_LOCAL_PORT_INVALID");
  const dirs = localPaths(process.env);
  fs.mkdirSync(dirs.durable, { recursive: true, mode: 0o700 });
  fs.mkdirSync(dirs.missions, { recursive: true, mode: 0o700 });
  const env = localExecutionEnv(process.env, dirs);
  for (const key of ["OSA_EXECUTION_MODE", "OSA_INTEGRATION_ENABLED", "OSA_ZERO_COST_ONLY",
    "OSA_WORKER_BASE_URL", "OSA_WORKER_TOKEN", "OSA_WORKSPACE_PROVIDER",
    "OSA_NEUROSA_BASE_URL", "OSA_NEUROSA_TOKEN", "OSA_NEUROSA_BRAIN_ID",
    "OSA_NEUROSA_ORGANIZATION_ID", "OSA_NEUROSA_PROJECT_ID",
    "OSA_NATIVE_BUILDER_EXECUTION", "OSA_AUTH_MODE", "OSA_DURABLE_DIR", "OSA_MISSION_STORE_DIR", "VERCEL"])
    process.env[key] = env[key];

  const { ApiState, handleApiRequest } = require(files.api);
  const { createDevExecution } = require(files.server);
  const { FileMissionStore } = require(files.missionStore);
  const { FileDurableJobStore } = require(files.durableStore);
  const { createConfiguredWeb3 } = require(files.web3);

  for (const key of ["OSA_NEUROSA_BASE_URL","OSA_NEUROSA_TOKEN","OSA_NEUROSA_BRAIN_ID","OSA_NEUROSA_ORGANIZATION_ID","OSA_NEUROSA_PROJECT_ID"]) { delete env[key]; delete process.env[key]; }
  const execution = createDevExecution(env); // Reuses canonical Mission Kernel + tools + Docker provider.
  const state = new ApiState(undefined, undefined, undefined, "open",
    new FileMissionStore(dirs.missions), execution.brain, createConfiguredWeb3(env), undefined,
    new FileMissionStore(path.join(dirs.durable, "missions")));
  const durableStore = new FileDurableJobStore(dirs.durable);
  const workerEnabled = Boolean(env.NVIDIA_API_KEY?.trim()) && env.OSA_NVIDIA_FREE_TIER_ACK === "true";
  let worker = null;

  const config = {
    port,
    staticRoot: files.staticRoot,
    cookie: randomBytes(32).toString("hex"),
    ticket: randomBytes(32).toString("hex"),
    used: false,
    health: async () => ({
      schema: "osa.local_host_health.v1",
      host: "READY_LOOPBACK",
      api: "INITIALIZED_NOT_E2E_VERIFIED",
      execution_mode: execution.mode,
      durable_worker: workerEnabled && worker && worker.exitCode === null && !worker.killed &&
        await durableStore.workerHealthy() ? "HEALTHY" : "BLOCKED",
      sandbox: dockerPreflight(env),
      memory: "NOT_PROBED",
      external_integrations: "DISABLED_P0",
      anchor_transactions: "DISABLED_P0",
      persistence: "LOCAL_MISSION_AND_DURABLE_FILES"
    })
  };
  const handler = createLocalHandler(config, (req, res) =>
    handleApiRequest(req, res, execution.registry, state, execution.description));
  const server = http.createServer((req, res) => {
    void handler(req, res).catch(() => { if (res.headersSent) res.destroy(); else reject(res, 500); });
  });
  await new Promise((resolve, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, "127.0.0.1", () => { server.off("error", rejectStart); resolve(); });
  });
  if (workerEnabled) {
    worker = spawn(process.execPath, [files.durableWorker], {
      cwd: options.root || ROOT, env, stdio: "inherit", windowsHide: true
    });
    worker.on("error", () => console.error("[OSA] Durable Worker — START FAILED"));
    worker.on("exit", code => console.error(`[OSA] Durable Worker — STOP ${code}`));
  }
  console.log(`[OSA] Host: http://127.0.0.1:${port}`);
  console.log(`[OSA] API: ${execution.mode} (P0, integracje zewnętrzne wyłączone)`);
  console.log(`[OSA] Durable Worker: ${workerEnabled ? "STARTING, awaiting heartbeat" : "BLOCKED: brak NVIDIA_API_KEY/ACK"}`);
  console.log(`[OSA] Docker preflight: ${dockerPreflight(env)}`);
  console.log(`[OSA] Dane: ${dirs.data} (nie usuwa się przy restarcie)`);
  console.log("[OSA] STOP: Ctrl+C, ponowny start: osa dashboard");

  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    console.log("[OSA] Zatrzymywanie. Nierozstrzygnięte zadania mogą pozostać UNKNOWN.");
    if (worker && !worker.killed) worker.kill("SIGTERM");
    server.closeAllConnections();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (!options.noBrowser) openBrowser(`http://127.0.0.1:${port}/__open?ticket=${config.ticket}`);
  return { server, config, dirs, shutdown };
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "doctor") {
    const files = buildFiles();
    const missing = buildMissing(files);
    console.log(JSON.stringify({
      schema: "osa.local_preflight.v1", node: process.versions.node,
      build: missing.length ? "MISSING" : "PRESENT_NOT_TESTED",
      sandbox: dockerPreflight(),
      missing_files: missing.map(f => path.relative(ROOT, f))
    }, null, 2));
    if (missing.length) process.exitCode = 1;
    return;
  }
  if (args.length !== 1 || args[0] !== "dashboard") {
    console.error("Użycie: osa doctor | osa dashboard");
    process.exitCode = 2;
    return;
  }
  await startDashboard();
}
if (require.main === module) main().catch(() => { console.error("[OSA] START BLOCKED — sprawdź build i konfigurację."); process.exitCode = 1; });
module.exports = { createLocalHandler, dockerPreflight, localPaths, localExecutionEnv,
  buildFiles, buildMissing, startDashboard, main };
