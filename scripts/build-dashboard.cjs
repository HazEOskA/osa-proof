"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const archive = path.join(root, "vendor", "osa-dashboard-integrated-src.tgz");
const work = path.join(root, ".osa-dashboard-src");
const output = path.join(root, "dashboard-dist");

function field(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "").trim();
}

function octal(buffer, start, length) {
  const raw = field(buffer, start, length);
  return raw ? Number.parseInt(raw, 8) : 0;
}

function safeRelative(name) {
  const normalized = path.posix.normalize(name.replace(/\\/g, "/")).replace(/^(\.\/)+/, "");
  if (!normalized || normalized === ".") return null;
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("unsafe tar path: " + name);
  }
  return normalized;
}

function extractTarGz(source, destination) {
  const tar = zlib.gunzipSync(fs.readFileSync(source));
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const rawPath = prefix ? prefix + "/" + name : name;
    const relative = safeRelative(rawPath);

    offset += 512;
    const body = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (!relative) continue;
    if (type === "x" || type === "g") continue;

    const target = path.resolve(destination, relative);
    if (target !== destination && !target.startsWith(destination + path.sep)) {
      throw new Error("tar entry escaped destination: " + relative);
    }

    if (type === "5") {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }

    if (type !== "0" && type !== "\0") {
      throw new Error("unsupported tar entry type " + JSON.stringify(type) + " for " + relative);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed with exit code " + result.status);
  }
}

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

extractTarGz(archive, work);

if (!fs.existsSync(path.join(work, "package.json"))) {
  throw new Error("dashboard package.json missing after extraction");
}

if (process.env.OSA_DASHBOARD_EXTRACT_ONLY === "1") {
  console.log("OSA dashboard extraction verified:", work);
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["install", "--no-audit", "--no-fund"], work);
run(npm, ["run", "build"], work);

const built = path.join(work, "dist");
if (!fs.existsSync(path.join(built, "index.html"))) {
  throw new Error("Vite build completed without dist/index.html");
}

fs.cpSync(built, output, { recursive: true });
console.log("OSA dashboard built:", output);
