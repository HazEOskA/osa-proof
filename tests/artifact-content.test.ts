import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mission, TeamGraph } from "../packages/contracts/src";
import { ExecutorRegistry, MissionKernel } from "../packages/runtime/src";
import { verifyCompletedMission, verifyEvidenceContents } from "../packages/proof-core/src";

const execFileAsync = promisify(execFile);
test("persisted evidence content is independently checked; missing, changed and unrelated bytes are rejected", async () => {
  const content = "Dowód UTF-8: zażółć 🐝\n";
  const graph: TeamGraph = { organization_id:"org",project_id:"project",team_id:"team",version:"1",agents:[{agent_id:"reader",role:"reader",executor_ref:"reader"}],edges:[] };
  const mission: Mission = { organization_id:"org",project_id:"project",team_id:"team",team_version:"1",mission_id:"content-mission",entry_agent_id:"reader",objective:"test content",input:{},
    requirements:[{requirement_id:"artifact",type:"evidence_field_equals",evidence_kind:"artifact",field:"ready",expected:true}] };
  const registry = new ExecutorRegistry(); registry.register("reader", () => ({ output:{},evidence:[{kind:"artifact",data:{ready:true},content}] }));
  const kernel = new MissionKernel(); await kernel.create(mission, graph); await kernel.execute(mission.mission_id, registry);
  const record = (await kernel.get(mission.mission_id))!; verifyCompletedMission(record);
  const id = record.run!.evidence[0].evidence_id;
  assert.deepEqual(verifyEvidenceContents(record.run!.evidence, {[id]:content}), {checked:1});
  assert.throws(() => verifyEvidenceContents(record.run!.evidence, {}), /MISSING/);
  assert.throws(() => verifyEvidenceContents(record.run!.evidence, {[id]:content+"x"}), /MISMATCH/);
  assert.throws(() => verifyEvidenceContents(record.run!.evidence, {[id]:content,foreign:"x"}), /UNEXPECTED/);
  assert.throws(() => verifyEvidenceContents([{...record.run!.evidence[0],content_bytes:0}], {[id]:content}), /MISMATCH/);
  assert.throws(() => verifyEvidenceContents([record.run!.evidence[0],record.run!.evidence[0]], {[id]:content}), /COMMITMENT_INVALID/);
  const temp = await mkdtemp(join(tmpdir(), "osa-content-"));
  try {
    const recordFile=join(temp,"record.json"),contentFile=join(temp,"content.json");
    await writeFile(recordFile,JSON.stringify(record)); await writeFile(contentFile,JSON.stringify({[id]:content}));
    const script=join(process.cwd(),"scripts/verify-mission-record.cjs");
    const result = JSON.parse((await execFileAsync(process.execPath,[script,recordFile,contentFile])).stdout);
    assert.equal(result.status,"VERIFIED"); assert.equal(result.evidence_content,"CHECKED");
    await assert.rejects(execFileAsync(process.execPath,[script,recordFile]));
    await writeFile(contentFile,JSON.stringify({[id]:content.replace("🐝","🐞")}));
    await assert.rejects(execFileAsync(process.execPath,[script,recordFile,contentFile]));
  } finally { await rm(temp,{recursive:true,force:true}); }
});
