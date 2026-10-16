"use strict";
const {execFileSync}=require("node:child_process"),fs=require("node:fs");
const base=process.argv[2]||"main";
const tracked=execFileSync("git",["diff","--name-only",base,"--"],{encoding:"utf8"}).trim().split("\n");
const untracked=execFileSync("git",["ls-files","--others","--exclude-standard"],{encoding:"utf8"}).trim().split("\n");
const patterns=[/nvapi-[A-Za-z0-9_-]{20,}/,/sk-or-v1-[A-Za-z0-9]{24,}/,/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const failures=[];let scanned=0;
for(const file of new Set([...tracked,...untracked])){
  if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
  const data=fs.readFileSync(file);if(data.includes(0))continue;
  scanned++;if(patterns.some(p=>p.test(data.toString("utf8"))))failures.push(file);
}
if(failures.length){console.error(JSON.stringify({status:"FAIL",files:failures,note:"Wartości nie są drukowane."}));process.exitCode=1;}
else console.log(JSON.stringify({status:"PASS",files_scanned:scanned,scope:"Znane formaty kluczy i klucze prywatne w zmienionych plikach; nie jest to pełny audyt sekretów."}));
