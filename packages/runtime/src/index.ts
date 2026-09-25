import { createHash } from "node:crypto";
import {
  AgentExecutor,
  AgentNode,
  Mission,
  RunResult,
  RuntimeEvent,
  RuntimeEventType,
  TeamGraph,
} from "../../contracts/src";
import { EventStore, MemoryEventStore } from "../../events/src";
import { EvidenceCollector } from "../../evidence/src";
import { DeterministicProofVerifier } from "../../proof-core/src";
import { getLinearExecutionOrder, validateMissionAgainstGraph, validateTeamGraph } from "../../team-graph/src";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export class ExecutorRegistry {
  private readonly executors = new Map<string, AgentExecutor>();

  register(ref: string, executor: AgentExecutor): void {
    if (!ref) throw new Error("executor ref is required");
    this.executors.set(ref, executor);
  }

  get(ref: string): AgentExecutor {
    const executor = this.executors.get(ref);
    if (!executor) throw new Error(`executor not registered: ${ref}`);
    return executor;
  }
}

export interface RuntimeOptions {
  eventStore?: EventStore;
  evidenceCollector?: EvidenceCollector;
  verifier?: DeterministicProofVerifier;
}

export class OsaRuntime {
  private readonly eventStore: EventStore;
  private readonly evidenceCollector: EvidenceCollector;
  private readonly verifier: DeterministicProofVerifier;

  constructor(private readonly registry: ExecutorRegistry, options: RuntimeOptions = {}) {
    this.eventStore = options.eventStore ?? new MemoryEventStore();
    this.evidenceCollector = options.evidenceCollector ?? new EvidenceCollector();
    this.verifier = options.verifier ?? new DeterministicProofVerifier();
  }

  static createRunId(graph: TeamGraph, mission: Mission): string {
    const attempt = mission.attempt ?? 1;
    return `run_${stableHash(
      `${graph.organization_id}|${graph.project_id}|${graph.team_id}|${graph.version}|${mission.mission_id}|${attempt}`
    )}`;
  }

  async run(graph: TeamGraph, mission: Mission): Promise<RunResult> {
    validateTeamGraph(graph);
    validateMissionAgainstGraph(graph, mission);
    const runId = OsaRuntime.createRunId(graph, mission);
    let eventSequence = 0;

    const emit = async (
      type: RuntimeEventType,
      payload: Record<string, unknown> = {},
      agent?: AgentNode
    ): Promise<void> => {
      eventSequence += 1;
      const event: RuntimeEvent = {
        event_id: `${runId}:event:${eventSequence}`,
        run_id: runId,
        sequence: eventSequence,
        type,
        organization_id: graph.organization_id,
        project_id: graph.project_id,
        team_id: graph.team_id,
        team_version: graph.version,
        mission_id: mission.mission_id,
        agent_id: agent?.agent_id,
        payload,
      };
      await this.eventStore.append(event);
    };

    await emit("RUN_CREATED", { objective: mission.objective });
    await emit("RUN_STARTED");

    const order = getLinearExecutionOrder(graph, mission.entry_agent_id);
    let currentInput: unknown = structuredClone(mission.input);
    let activeAgent: AgentNode | undefined;
    let runtimeFailure: string | undefined;

    try {
      for (let index = 0; index < order.length; index += 1) {
        const agentId = order[index];
        const agent = graph.agents.find((candidate) => candidate.agent_id === agentId);
        if (!agent) throw new Error(`agent disappeared from validated graph: ${agentId}`);
        activeAgent = agent;

        await emit("AGENT_STARTED", { role: agent.role, executor_ref: agent.executor_ref }, agent);
        const executor = this.registry.get(agent.executor_ref);
        const result = await executor({
          run_id: runId,
          mission,
          agent,
          input: structuredClone(currentInput),
        });

        for (const evidence of result.evidence) {
          const record = this.evidenceCollector.record({
            run_id: runId,
            graph,
            mission,
            agent_id: agent.agent_id,
            evidence,
          });
          await emit("EVIDENCE_RECORDED", { evidence_id: record.evidence_id, kind: record.kind }, agent);
        }

        currentInput = structuredClone(result.output);
        await emit("AGENT_COMPLETED", {}, agent);

        const nextAgentId = order[index + 1];
        if (nextAgentId) {
          await emit("HANDOFF_CREATED", { from_agent_id: agent.agent_id, to_agent_id: nextAgentId }, agent);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeFailure = message;
      await emit("AGENT_FAILED", { error: message }, activeAgent);
    }

    const evidence = this.evidenceCollector.list(runId);
    await emit("VERIFICATION_STARTED", { requirement_count: mission.requirements.length });
    const proof = this.verifier.verify({ run_id: runId, graph, mission, evidence });
    if (runtimeFailure) {
      proof.verdict = "FAILED";
      proof.requirement_verdicts.push({
        requirement_id: "__runtime_execution__",
        verdict: "FAILED",
        evidence_ids: [],
        reason: runtimeFailure,
      });
    }

    if (proof.verdict === "VERIFIED") {
      await emit("VERIFICATION_PASSED", { proof_id: proof.proof_id });
      await emit("RUN_VERIFIED", { proof_id: proof.proof_id });
    } else {
      await emit("VERIFICATION_FAILED", { proof_id: proof.proof_id, verdict: proof.verdict });
      await emit(proof.verdict === "FAILED" ? "RUN_FAILED" : "RUN_INCOMPLETE", { proof_id: proof.proof_id });
    }

    return {
      run_id: runId,
      verdict: proof.verdict,
      final_output: currentInput,
      events: await this.eventStore.list(runId),
      evidence,
      proof,
    };
  }
}
