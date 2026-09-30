// Captures REAL data from a running osa-proof API (+ local repo tree) into src/data/snapshot.json.
// Usage: node scripts/snapshot.mjs <apiBase> <osa-proof repo path> [runId...]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
const [base = "http://127.0.0.1:3111", repo = "../hazeoska/osa-proof", ...runIds] = process.argv.slice(2);
const j = async (p) => (await fetch(base + p)).json();
const runs = runIds.map((id) => JSON.parse(readFileSync(`/tmp/${id}.json`, "utf8")));
const missions = ["mission_verified","mission_failed"].map((f) => JSON.parse(readFileSync(`/tmp/${f}.json`, "utf8")));
const team = await j("/teams/team_dev?version=1");
const layers = await j("/layers");
const ls = (d) => existsSync(join(repo, d)) ? readdirSync(join(repo, d)).filter((n) => statSync(join(repo, d, n)).isDirectory()) : [];
const docs = existsSync(join(repo, "docs")) ? readdirSync(join(repo, "docs")).filter((n) => n.endsWith(".md")) : [];
const out = {
  captured_at: new Date().toISOString(),
  source: { api: "osa-proof API", mode: "fixture", repo: "HazEOskA/osa-proof", commit: process.env.OSA_COMMIT ?? null },
  layers, team, missions, runs,
  repo: { packages: ls("packages"), apps: ls("apps"), docs },
};
writeFileSync("src/data/snapshot.json", JSON.stringify(out, null, 1));
console.log("ok", runs.length, "runs", out.repo.packages.length, "packages");
