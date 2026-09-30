import { Experiment } from "../../experiments/src";
import { RunResult } from "../../contracts/src";
import { digest, verifyProofReceipt } from "../../proof-core/src";
export type BenchmarkCategory = "MODEL" | "AGENT" | "TEAM" | "FRAMEWORK" | "TOOL" | "SKILL" | "PIPELINE" | "MISSION" | "INFRASTRUCTURE";
export interface BenchmarkResult {
  schema: "osa.benchmark_result.v1"; mission_id: string; organization_id: string; project_id: string;
  subject: { category: BenchmarkCategory; ref: string; version: string };
  workload: { ref: string; sha256: string }; quality: number; latency_ms: number | null; cost: number | null;
  reliability: number; failures: number; environment: { ref: string; sha256: string };
  evidence: string[]; timestamp: string; receipt_sha256: string;
}
export function verifyBenchmark(result: BenchmarkResult): void {
  const { receipt_sha256, ...body } = result;
  if (digest(body) !== receipt_sha256 || !result.mission_id || !result.organization_id || !result.project_id || !["MODEL","AGENT","TEAM","FRAMEWORK","TOOL","SKILL","PIPELINE","MISSION","INFRASTRUCTURE"].includes(result.subject.category) || !result.subject.ref || !result.subject.version || !result.workload.ref || !result.environment.ref || !/^[a-f0-9]{64}$/.test(result.workload.sha256) || !/^[a-f0-9]{64}$/.test(result.environment.sha256) || !Number.isFinite(result.quality) || result.quality < 0 || result.quality > 1 || !Number.isFinite(result.reliability) || result.reliability < 0 || result.reliability > 1 || !Number.isInteger(result.failures) || result.failures < 0 || !result.evidence.length || !Number.isFinite(Date.parse(result.timestamp)) || [result.latency_ms,result.cost].some(v => v !== null && (!Number.isFinite(v) || v < 0))) throw new Error("BENCHMARK_INVALID");
}
/** Converts existing Experiment evidence; never invents cost or latency from scores. */
export function benchmarkFromExperiment(experiment: Experiment, scope: { mission_id: string; organization_id: string; project_id: string }, environment: { ref: string; sha256: string }, runs: RunResult[]): BenchmarkResult {
  const { experiment_sha256, ...original } = experiment;
  if (digest(original) !== experiment_sha256 || !experiment.results.length || experiment.summary.examples !== experiment.results.length) throw new Error("EXPERIMENT_INVALID");
  for (const example of experiment.results) {
    const run = runs.find(r => r.run_id === example.run_id && r.proof.proof_id === example.proof_id);
    if (!run || run.proof.binding.organization_id !== scope.organization_id || run.proof.binding.project_id !== scope.project_id || run.proof.binding.team_id !== experiment.team_id || run.proof.binding.team_version !== experiment.team_version || run.verdict !== example.verdict || !verifyProofReceipt({ receipt: run.proof, evidence: run.evidence, observations: run.observations, final_output: run.final_output }).ok) throw new Error("BENCHMARK_SOURCE_PROOF_INVALID");
  }
  const verified = experiment.results.filter(r => r.verdict === "VERIFIED").length;
  const body: Omit<BenchmarkResult,"receipt_sha256"> = { schema: "osa.benchmark_result.v1", ...scope, subject: { category: "TEAM", ref: experiment.team_id, version: experiment.team_version }, workload: { ref: `${experiment.dataset_id}@${experiment.dataset_version}`, sha256: experiment.dataset_version_sha256 }, quality: verified / experiment.results.length, latency_ms: null, cost: null, reliability: verified / experiment.results.length, failures: experiment.results.length - verified, environment, evidence: [experiment_sha256,...experiment.results.map(r => r.proof_id)], timestamp: experiment.created_at };
  const result = { ...body, receipt_sha256: digest(body) }; verifyBenchmark(result); return result;
}
export class BenchmarkStore {
  private results: BenchmarkResult[] = [];
  add(result: BenchmarkResult): void { verifyBenchmark(result); if (!this.results.some(r => r.receipt_sha256 === result.receipt_sha256)) this.results.push(structuredClone(result)); }
  list(): BenchmarkResult[] { return structuredClone(this.results); }
  select(params: { organization_id: string; project_id: string; category: BenchmarkCategory; workload_sha256: string; environment_sha256: string; allowed: string[]; minReliability: number; maxAgeMs: number; now?: number }): BenchmarkResult | undefined {
    if (!Number.isFinite(params.maxAgeMs) || params.maxAgeMs < 0 || !Number.isFinite(params.minReliability) || params.minReliability < 0 || params.minReliability > 1) throw new Error("BENCHMARK_ROUTING_POLICY_INVALID");
    const now = params.now ?? Date.now();
    const candidates = this.results.filter(r => r.organization_id === params.organization_id && r.project_id === params.project_id && r.subject.category === params.category && r.workload.sha256 === params.workload_sha256 && r.environment.sha256 === params.environment_sha256 && params.allowed.includes(`${r.subject.ref}@${r.subject.version}`) && r.reliability >= params.minReliability && now >= Date.parse(r.timestamp) && now - Date.parse(r.timestamp) <= params.maxAgeMs);
    candidates.sort((a,b) => b.quality - a.quality || b.reliability - a.reliability || Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return candidates[0] ? structuredClone(candidates[0]) : undefined;
  }
}
