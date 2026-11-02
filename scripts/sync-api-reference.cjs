#!/usr/bin/env node
"use strict";
// Generates the HTTP docs table and validates its count against the canonical PERMISSIONS inventory.
// This is a contract inventory: verify runtime gates through tests/control.test.ts (not an OpenAPI router).
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const control = fs.readFileSync(path.join(root,"packages/control/src/index.ts"),"utf8");
const htmlPath = path.join(root,"apps/web/docs/index.html");
const original = fs.readFileSync(htmlPath,"utf8");
// Git on Windows can check out HTML with CRLF even when the repository stores LF.
// Compare canonical LF representations: line-ending conversion is not API drift.
const input = original.replace(/\r\n/g,"\n");
const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
const desc = {
  "GET /chat/delivery/status": "Server-bound artifact generation availability and model; no provider call.",
  "POST /chat/delivery": "Stream agent lifecycle events, generate model artifact and deliver sealed bundle; session, free-tier and quota gates.",
  "GET /auth/providers": "Login providers; only local-dev is enabled.",
  "POST /auth/dev-login": "DEV identity and session token (201).",
  "GET /session": "The current session (401 without one).",
  "POST /session/logout": "Revoke the session token.",
  "GET /layers": "The six layer profiles.",
  "GET /layers/:id": "One layer profile.",
  "POST /layers/:id/enter": "<code>ALLOWED</code> or <code>GATED</code>, decided by the backend.",
  "POST /teams": "The validated Team Graph (201).",
  "GET /teams/:id?version=": "One Team Graph version.",
  "POST /missions": "The stored mission (201).",
  "POST /missions/:id/run": "The full run result with receipt (201).",
  "GET /runs/:id": "Latest execution of that run.",
  "GET /runs/:id/events": "Runtime events.",
  "GET /runs/:id/evidence": "Evidence records.",
  "GET /runs/:id/proof": "The sealed proof receipt.",
  "GET /build/status": "Execution mode, auth mode, persistence and protocol support.",
  "GET /build/workspace": "The saved Build workspace (404 until one is saved).",
  "POST /build/workspace": "Validate and save the Build workspace; registers its Team Graph (201).",
  "GET /deployments": "Deployments, newest first.",
  "POST /deployments": "Deploy a registered team version to preview or production (201).",
  "POST /deployments/:id/promote": "Promote a preview deployment to production (201).",
  "POST /deployments/rollback": "Reactivate the previous deployment of a team in an environment.",
  "POST /deployments/:id/run": "Run a mission on the pinned graph after policies allow it (201, 403 when denied).",
  "GET /policies": "Policies.",
  "POST /policies": "Add a policy (201).",
  "POST /policies/evaluate": "Evaluate a team version and mission against enabled policies.",
  "GET /experiments": "Experiments, newest first.",
  "POST /experiments": "Run a dataset version against a team version with evaluators (201).",
  "GET /experiments/compare?a=&b=": "Per-example changes between two experiments.",
  "GET /queue": "Queued, running and finished jobs.",
  "POST /queue": "Queue a mission now or at run_at (201).",
  "POST /queue/drain": "Run due jobs.",
  "GET /organizations": "Registered and observed organizations.",
  "GET /secrets": "Secret names and whether they are set.",
  "GET /permissions": "Route-by-route enforcement table.",
  "GET /knowledge": "Collections with document and chunk counts.",
  "GET /knowledge/:collection": "Documents in a collection.",
  "POST /knowledge/:collection/documents": "Add a document; chunks and digests are computed by the API (201).",
  "GET /knowledge/:collection/documents/:id": "One document with its chunks.",
  "POST /knowledge/:collection/search": "BM25 search; hits cite chunk and document digests.",
  "GET /intelligence": "Status reports for the nine Intelligence modules.",
  "GET /intelligence/:id": "One module report with its proofs.",
  "POST /datasets": "Create a dataset; version 1 (201).",
  "GET /datasets": "Latest version summary per dataset.",
  "GET /datasets/:id?as_of=": "One version by number, tag or latest.",
  "GET /datasets/:id/versions": "Version history with tags.",
  "POST /datasets/:id/versions": "Commit upserts and removals as a new version (201).",
  "PUT /datasets/:id/tags/:tag": "Pin a tag to a version.",
  "GET /datasets/:id/verify?as_of=": "Recompute example and version digests.",
  "POST /evaluators": "Register a deterministic or labeled evaluator (201).",
  "GET /evaluators": "All evaluator definitions.",
  "GET /evaluators/:id": "One evaluator definition.",
  "POST /runs/:id/evaluations": "Score a run, optionally against a pinned dataset example (201).",
  "POST /runs/:id/labels": "Record a human label on the evaluator's scale (201).",
  "GET /runs/:id/evaluations": "Every evaluation result for the run.",
  "GET /missions/:id": "Read a stored mission (session and matching tenant required).",
  "GET /missions/:id/timeline": "Mission event timeline.",
  "GET /missions/:id/run": "Accepted run for the mission, or 404.",
  "GET /missions/:id/receipt": "Mission proof receipt, if available.",
  "GET /missions/:id/plan": "Accepted plan, or 404.",
  "POST /missions/:id/plan": "Create a plan using the configured Brain/runtime.",
  "POST /missions/:id/cancel": "Cancel a mission in the scoped runtime.",
  "GET /deployments/:id": "Inspect a deployment after session verification.",
  "DELETE /policies/:id": "Remove a policy after session verification.",
  "GET /experiments/:id": "Inspect one recorded experiment.",
  "DELETE /queue/:id": "Cancel a queued job (conflict if already running).",
  "POST /organizations": "Register an organization after session verification.",
  "GET /templates/delivery-lab": "Read the currently supported Delivery Lab template.",
  "POST /templates/delivery-lab/runs": "Execute Delivery Lab starter or connected mission; requires a session.",
  "GET /templates/delivery-lab/missions/:id": "Read a Delivery Lab report in its existing execution scope.",
  "GET /web3/status": "Inspect read-only Web3 capabilities and current scope.",
  "POST /web3/observe": "Run a scoped Web3 observation when enabled; requires a developer session.",
  "GET /web3/missions/:id": "Read a scoped Web3 mission record.",
  "POST /web3/intents/preview": "Inspect an intent policy decision without executing the intent.",
  "GET /memory/status": "Memory adapter status; private NeurOSA may additionally require identity.",
  "POST /memory/diagnostic": "Restricted Preview-only memory write/recall diagnostic.",
  "GET /memory/receipts/:id": "Read an authorized memory receipt.",
  "POST /unified/execute": "Execute a scoped Unified mission; tool mode requires service authorization.",
  "POST /unified/verify": "Verify an existing Unified evidence bundle.",
  "POST /trace-probe": "Bounded runtime trace diagnostic requiring a session.",
  "GET /nvidia/status": "Provider configuration and availability (not proof of successful generation).",
  "POST /nvidia/chat": "Server-side NVIDIA chat with request validation and cost guard.",
  "POST /nvidia/fleet-chat": "Agent fleet chat with memory and rate checks.",
  "GET /platform/status": "Inspect platform status in the current organization scope.",
  "POST /platform/deployments/review": "Review a scoped deployment plan without running it."
};
const routes = [...control.matchAll(/\{\s*permission:\s*"([^"]+)",\s*method:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*enforced:\s*"(session|public)"\s*\}/g)].map(m=>({permission:m[1],method:m[2],route:m[3],auth:m[4]}));
if (!routes.length || routes.some(r=>!desc[r.method+" "+r.route]) || new Set(routes.map(r=>r.method+" "+r.route)).size!==routes.length)
  throw Error("API route inventory empty, duplicated, or missing description");
const esc = s=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const table = "        <tbody>\n          <!-- AUTO-GENERATED API ROUTES: run npm run docs:sync; do not hand-edit rows -->\n"+
  routes.map(r=>"          <tr><td><span class=\"m\">"+r.method+"</span></td><td><code>"+esc(r.route)+"</code></td><td><code>"+r.auth+"</code></td><td>"+desc[r.method+" "+r.route]+"</td></tr>").join("\n")+"\n        </tbody>";
const start = input.indexOf('    <section id="api"');
const end = input.indexOf("    </section>",start);
if(start<0||end<0)throw Error("HTTP API section missing");
const section = input.slice(start,end);
const generatedSection = section.replace(/        <tbody>[\s\S]*?<\/tbody>/,table);
const withCount = input.slice(0,start)+generatedSection+input.slice(end);
const result = withCount.replace(/<span data-api-route-count>\d+<\/span>/g,"<span data-api-route-count>"+routes.length+"</span>");
if (!section.includes("<tbody>") || !input.includes("data-api-route-count"))throw Error("Missing API-doc generation anchors");
if (process.argv.includes("--check")) {
  if(result!==input){console.error("HTTP docs drift: run npm run docs:sync");process.exitCode=1;}
  else console.log("HTTP API docs synchronized:",routes.length,"route pairs");
} else if (process.argv.includes("--write")) {
  if(result!==input)fs.writeFileSync(htmlPath,result.replace(/\n/g,lineEnding));
  console.log("HTTP API docs generated:",routes.length,"route pairs");
} else {console.error("Use --check or --write");process.exitCode=2;}
