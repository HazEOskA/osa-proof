import { CapabilityCatalog, nativeCapability } from "../../capabilities/src";
import { BenchmarkStore } from "../../benchmarks/src";
import { CloudRegistry, DeploymentPlan, verifyDeploymentPlan } from "../../deployment/src";
import { ExecutorRegistry, MissionKernel } from "../../runtime/src";
import { FleetQueue } from "../../fleet/src";
/** Composition root, reuses MissionKernel and existing ExecutorRegistry; no second execution runtime. */
export class PlatformControlPlane {
  readonly capabilities = new CapabilityCatalog();
  readonly benchmarks = new BenchmarkStore();
  readonly clouds = new CloudRegistry();
  constructor(readonly fleet: FleetQueue = new FleetQueue()) {}
  registerExecutors(registry: ExecutorRegistry): void {
    for (const ref of registry.refs()) this.capabilities.register(nativeCapability(ref),registry.get(ref));
  }
  syncExecutors(registry: ExecutorRegistry): void {
    const known = new Set(this.capabilities.list().map(c => c.executor_ref));
    for (const ref of registry.refs()) if (!known.has(ref)) this.capabilities.register(nativeCapability(ref),registry.get(ref));
  }
  describe(organization_id?: string) {
    return { version: "0.5-local-review", mode: "PRE_DEPLOY", persistence: "PROCESS_MEMORY", fleet: this.fleet.snapshot().filter(w => !organization_id || w.organization_id === organization_id), capabilities: this.capabilities.list(), benchmark_results: this.benchmarks.list().filter(b => !organization_id || b.organization_id === organization_id).length, cloud_providers: this.clouds.list(), deployment_execution_enabled: false };
  }
  reviewDeployment(plan: DeploymentPlan) {
    verifyDeploymentPlan(plan);
    return { plan: structuredClone(plan), state: "AWAITING_DEPLOYMENT", provider_registered: this.clouds.list().includes(plan.provider), executed: false };
  }
  async runOne(workerId: string, kernel: MissionKernel, registry: ExecutorRegistry): Promise<boolean> {
    const lease = this.fleet.claim(workerId); if (!lease) return false;
    const job = this.fleet.list().find(j => j.job_id === lease.job_id)!;
    const worker = this.fleet.snapshot().find(w => w.worker_id === workerId)!;
    let lost = false;
    const timer = setInterval(() => { try { this.fleet.renew(lease); } catch { lost = true; } },10000); timer.unref();
    try {
      const record = await kernel.get(job.mission_id);
      if (!record || record.mission.organization_id !== worker.organization_id || record.mission.project_id !== worker.project_id) throw new Error("FLEET_MISSION_SCOPE_DENIED");
      const guarded = new ExecutorRegistry();
      for (const ref of registry.refs()) guarded.register(ref, context => { if (lost) throw new Error("FLEET_LEASE_LOST"); this.fleet.renew(lease); return registry.get(ref)(context); });
      const run = await kernel.execute(job.mission_id,guarded);
      if (lost) throw new Error("FLEET_LEASE_LOST");
      this.fleet.complete(lease,{ run_id: run.run_id, verdict: run.verdict });
    } catch (error) {
      if (!lost) { try { this.fleet.complete(lease,{ error: "FLEET_EXECUTION_FAILED" }); } catch { /* expired fence cannot finalize */ } }
      throw error;
    } finally { clearInterval(timer); }
    return true;
  }
}
