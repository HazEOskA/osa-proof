import { randomUUID } from "node:crypto";
import { JobQueue, Job, ControlError } from "../../control/src";
import { AgentExecutionContext, AgentExecutionResult, AgentExecutor } from "../../contracts/src";
import { digest } from "../../proof-core/src";
import { WorkspaceProvider, WorkspaceHandle } from "../../workspace-runtime/src";

export interface Worker { worker_id: string; organization_id: string; project_id: string; capacity: number; active: number; heartbeat_at: number; draining: boolean }
export interface Lease { job_id: string; worker_id: string; token: string; generation: number; expires_at: number }
/** Reuses JobQueue storage. Single-process fencing; not a distributed durable broker. */
export class FleetQueue extends JobQueue {
  private workers = new Map<string, Worker>();
  private leases = new Map<string, Lease>();
  private generations = new Map<string, number>();
  private scopes = new Map<string, { organization_id: string; project_id: string }>();
  register(worker: Pick<Worker, "worker_id" | "organization_id" | "project_id" | "capacity">): void {
    if (this.workers.has(worker.worker_id) || !worker.worker_id || !worker.organization_id || !worker.project_id || !Number.isInteger(worker.capacity) || worker.capacity < 1 || worker.capacity > 64) throw new ControlError("invalid or duplicate worker");
    this.workers.set(worker.worker_id, { ...worker, active: 0, draining: false, heartbeat_at: this.clock().getTime() });
  }
  heartbeat(id: string): void { this.worker(id).heartbeat_at = this.clock().getTime(); }
  drain(id: string): void { this.worker(id).draining = true; }
  enqueueScoped(params: { mission_id: string; organization_id: string; project_id: string }): Job {
    if (!params.organization_id || !params.project_id) throw new ControlError("job scope required");
    const job = super.enqueue(params); this.scopes.set(job.job_id, { organization_id: params.organization_id, project_id: params.project_id }); return job;
  }
  // A scoped job cannot be stolen by legacy /queue/drain.
  override takeDue(max = 10): Job[] {
    const leased = this.jobs.filter(j => this.scopes.has(j.job_id) && j.status === "QUEUED");
    for (const j of leased) j.status = "RUNNING";
    try { return super.takeDue(max); } finally { for (const j of leased) j.status = "QUEUED"; }
  }
  override finish(id: string, outcome: { run_id: string; verdict: string } | { error: string }): Job {
    if (this.scopes.has(id)) throw new ControlError("lease required", "forbidden");
    return super.finish(id, outcome);
  }
  claim(workerId: string, ttlMs = 30000): Lease | undefined {
    if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 300000) throw new ControlError("invalid lease TTL");
    this.recover(); const w = this.worker(workerId); const now = this.clock().getTime();
    if (w.draining || w.active >= w.capacity || now - w.heartbeat_at > 30000) return;
    const j = this.jobs.find(j => { const s = this.scopes.get(j.job_id); return j.status === "QUEUED" && Date.parse(j.run_at) <= now && s?.organization_id === w.organization_id && s.project_id === w.project_id; });
    if (!j) return;
    const generation = (this.generations.get(j.job_id) ?? 0) + 1;
    const lease = { job_id: j.job_id, worker_id: workerId, token: randomUUID(), generation, expires_at: now + ttlMs };
    j.status = "RUNNING"; w.active++; this.generations.set(j.job_id, generation); this.leases.set(j.job_id, lease); return structuredClone(lease);
  }
  renew(lease: Lease, ttlMs = 30000): Lease {
    if (!Number.isInteger(ttlMs) || ttlMs < 100 || ttlMs > 300000) throw new ControlError("invalid lease TTL");
    const live = this.assertLease(lease); live.expires_at = this.clock().getTime() + ttlMs; this.heartbeat(live.worker_id); return structuredClone(live);
  }
  complete(lease: Lease, outcome: { run_id: string; verdict: string } | { error: string }): Job {
    this.assertLease(lease); const job = super.finish(lease.job_id, outcome); this.release(lease); return job;
  }
  recover(): void {
    const now = this.clock().getTime();
    for (const lease of [...this.leases.values()]) if (lease.expires_at <= now || now - this.worker(lease.worker_id).heartbeat_at > 30000) {
      this.jobs.find(j => j.job_id === lease.job_id)!.status = "QUEUED"; this.release(lease);
    }
  }
  snapshot(): Worker[] { return structuredClone([...this.workers.values()]); }
  scaleRecommendation(backlog: number, capacityPerWorker = 1): number {
    if (!Number.isInteger(backlog) || backlog < 0 || !Number.isInteger(capacityPerWorker) || capacityPerWorker < 1) throw new ControlError("invalid capacity");
    return Math.ceil(backlog / capacityPerWorker); // advisory; no cloud side effect
  }
  private worker(id: string): Worker { const w = this.workers.get(id); if (!w) throw new ControlError("worker not found", "not_found"); return w; }
  private release(l: Lease): void { this.leases.delete(l.job_id); this.worker(l.worker_id).active--; }
  private assertLease(l: Lease): Lease {
    this.recover(); const live = this.leases.get(l.job_id);
    if (!live || live.worker_id !== l.worker_id || live.token !== l.token || live.generation !== l.generation) throw new ControlError("stale lease", "conflict");
    return live;
  }
}

export type SandboxAgent = (context: AgentExecutionContext, workspace: WorkspaceHandle) => Promise<AgentExecutionResult>;
/** Wraps the existing AgentExecutor: one sandbox per pinned task, evidence consumed by the existing verifier. */
export function sandboxExecutor(provider: WorkspaceProvider, execute: SandboxAgent, timeoutMs = 120000): AgentExecutor {
  return async context => {
    const pinned = context.mission_plan?.tasks.find(t => t.agent_id === context.agent.agent_id);
    const scope = { organization_id: context.mission.organization_id, project_id: context.mission.project_id, mission_id: context.mission.mission_id, task_id: pinned?.task_id ?? context.operation_id };
    const workspace = await provider.create({ workspaceId: `${scope.mission_id}-${context.agent.agent_id}`, scope, timeoutMs, ports: [] });
    let result: AgentExecutionResult;
    try { result = await execute(context, workspace); }
    catch (error) { await workspace.stop(); throw error; }
    // Cleanup is part of success. A failure must not produce successful sandbox evidence.
    await workspace.stop();
    const body = { schema: "osa.sandbox_receipt.v1", ...scope, workspace_id: workspace.id, provider: provider.id, execution_id: context.execution_id, output_sha256: digest(result.output), lifecycle: ["CREATE", "EXECUTE", "DESTROY"] };
    return { ...result, evidence: [...result.evidence, { kind: "sandbox_receipt", data: { ...body, receipt_sha256: digest(body) } }] };
  };
}
