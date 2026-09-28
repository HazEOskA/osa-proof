import { createHash, randomUUID } from "node:crypto";
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
import { bindingFor, DeterministicProofVerifier } from "../../proof-core/src";
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
  clock?: () => Date;
  createExecutionId?: () => string;
}

export class OsaRuntime {
  private readonly eventStore: EventStore;
  private readonly evidenceCollector: EvidenceCollector;
  private readonly verifier: DeterministicProofVerifier;
  private readonly clock: () => Date;
  private readonly createExecutionId: () => string;

  constructor(private readonly registry: ExecutorRegistry, options: RuntimeOptions = {}) {
    this.eventStore = options.eventStore ?? new MemoryEventStore();
    this.evidenceCollector = options.evidenceCollector ?? new EvidenceCollector();
    this.verifier = options.verifier ?? new DeterministicProofVerifier();
    this.clock = options.clock ?? (() => new Date());
    this.createExecutionId = options.createExecutionId ?? (() => `exec_${randomUUID()}`);
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
    const executionId = this.createExecutionId();
    const binding = bindingFor(graph, mission, runId, executionId);
    let eventSequence = 0;

    const emit = async (
      type: RuntimeEventType,
      payload: Record<string, unknown> = {},
      agent?: AgentNode
    ): Promise<void> => {
      eventSequence += 1;
      const event: RuntimeEvent = {
        event_id: `${runId}:${executionId}:event:${eventSequence}`,
        run_id: runId,
        execution_id: executionId,
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
        const operationId = `${executionId}:op:${index + 1}:${agent.agent_id}`;

        await emit(
          "AGENT_STARTED",
          { role: agent.role, executor_ref: agent.executor_ref, operation_id: operationId },
          agent
        );
        const executor = this.registry.get(agent.executor_ref);
        const result = await executor({
          run_id: runId,
          execution_id: executionId,
          operation_id: operationId,
          mission,
          agent,
          input: structuredClone(currentInput),
        });

        for (const evidence of result.evidence) {
          const record = this.evidenceCollector.record({
            binding,
            producer: {
              type: "executor",
              agent_id: agent.agent_id,
              executor_ref: agent.executor_ref,
              operation_id: operationId,
            },
            evidence,
          });
          await emit(
            "EVIDENCE_RECORDED",
            { evidence_id: record.evidence_id, kind: record.kind, evidence_sha256: record.evidence_sha256 },
            agent
          );
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

    const evidence = this.evidenceCollector.list(executionId);
    await emit("VERIFICATION_STARTED", { requirement_count: mission.requirements.length });
    // The verifier derives the final verdict (including runtime failure) and only then
    // seals the receipt, so proof_id always commits to the final contents.
    const { proof, observations } = this.verifier.verify({
      run_id: runId,
      execution_id: executionId,
      graph,
      mission,
      evidence,
      runtime_failure: runtimeFailure,
      final_output: currentInput,
      created_at: this.clock().toISOString(),
    });

    if (proof.verdict === "VERIFIED") {
      await emit("VERIFICATION_PASSED", { proof_id: proof.proof_id });
      await emit("RUN_VERIFIED", { proof_id: proof.proof_id });
    } else {
      await emit("VERIFICATION_FAILED", { proof_id: proof.proof_id, verdict: proof.verdict });
      await emit(proof.verdict === "FAILED" ? "RUN_FAILED" : "RUN_INCOMPLETE", { proof_id: proof.proof_id });
    }

    const events = (await this.eventStore.list(runId)).filter((event) => event.execution_id === executionId);
    return {
      run_id: runId,
      execution_id: executionId,
      verdict: proof.verdict,
      final_output: currentInput,
      events,
      evidence,
      observations,
      proof,
    };
  }
}
