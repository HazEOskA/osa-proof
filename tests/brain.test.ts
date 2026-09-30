import assert from "node:assert/strict";
import test from "node:test";
import { BrainMemory, BrainPlanProposal, BrainPlanRequest, BrainPlanner, Mission, TeamGraph } from "../packages/contracts/src";
import { BrainControlPlane, NativeBrainPlanner, verifyBrainPlan } from "../packages/brain/src";
import { ModelBrainPlanner, NeurosaMemoryAdapter, createConfiguredBrain, ModelProvider } from "../packages/adapters/src";
import { digest } from "../packages/proof-core/src/canonical";
import { verifyCompletedMission } from "../packages/proof-core/src";
import { ExecutorRegistry, MemoryMissionStore, MissionKernel, OsaRuntime } from "../packages/runtime/src";

const graph: TeamGraph = {
  organization_id: "org", project_id: "project", team_id: "team", version: "1",
  agents: [{ agent_id: "planner", role: "planner", executor_ref: "planner" }, { agent_id: "builder", role: "builder", executor_ref: "builder", model_ref: "openai:builder" }],
  edges: [{ edge_id: "handoff", from_agent_id: "planner", to_agent_id: "builder", kind: "handoff" }],
};
const mission = (): Mission => ({ organization_id: "org", project_id: "project", mission_id: "mission", team_id: "team", team_version: "1",
  objective: "Implement and test an app", entry_agent_id: "planner", input: {}, requirements: [{ requirement_id: "built", type: "evidence_field_equals", agent_id: "builder", evidence_kind: "artifact", field: "status", expected: "built" }] });
function request(): BrainPlanRequest {
  const task_graph = { mission_id: "mission", nodes: [
    { task_id: "mission:task:1", mission_id: "mission", agent_id: "planner", depends_on: [], state: "PENDING" as const },
    { task_id: "mission:task:2", mission_id: "mission", agent_id: "builder", depends_on: ["mission:task:1"], state: "PENDING" as const },
  ] };
  return { mission: mission(), team: graph, task_graph, world_state: { mission_state: "CREATED", team_version: "1", task_states: task_graph.nodes.map((t) => ({ task_id: t.task_id, state: "PENDING" })) } };
}
function proposal(): BrainPlanProposal {
  return { summary: "Build with explicit checks", goals: ["Implement app", "Run tests"], tasks: [
    { task_id: "mission:task:1", agent_id: "planner", instruction: "Specify implementation and acceptance checks" },
    { task_id: "mission:task:2", agent_id: "builder", instruction: "Implement the plan and produce test evidence" },
  ] };
}
function model(value: unknown = proposal(), onCall: (request: unknown) => void = () => {}): ModelProvider {
  return { id: "openai", model: "brain", complete: async (input) => {
    onCall(input);
    return { provider: "openai", model: "brain", response_id: "response", http_status: 200, stop_reason: "stop", text: JSON.stringify(value),
      usage: { input_tokens: 10, output_tokens: 20 }, latency_ms: 1, request_sha256: digest(input), response_sha256: digest(value) };
  } };
}
function executors(onExecute: (context: Parameters<Parameters<ExecutorRegistry["register"]>[1]>[0]) => void = () => {}): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register("planner", (ctx) => { onExecute(ctx); return { output: ctx.input, evidence: [] }; });
  registry.register("builder", (ctx) => { onExecute(ctx); return { output: {}, evidence: [{ kind: "artifact", data: { status: "built" } }] }; });
  return registry;
}

test("model Brain decomposes intent and pins instructions/receipts before any execution", async () => {
  const calls: unknown[] = [];
  const brain = new BrainControlPlane(new ModelBrainPlanner(model(proposal(), (request) => calls.push(request))));
  const kernel = new MissionKernel(undefined, undefined, brain);
  const created = await kernel.create(mission(), graph);
  assert.equal(created.brain, undefined);
  let executions = 0;
  const registry = executors((ctx) => {
    executions++;
    assert.equal(ctx.mission_plan?.plan_sha256, planned.brain?.plan.plan_sha256);
    assert.equal(ctx.mission_plan?.tasks.find((task) => task.agent_id === ctx.agent.agent_id)?.instruction, proposal().tasks.find((task) => task.agent_id === ctx.agent.agent_id)?.instruction);
    // A hostile executor cannot rewrite another agent's plan or Mission acceptance.
    ctx.mission.requirements[0].expected = "forged";
    ctx.mission_plan!.tasks[1].instruction = "forged";
    ctx.agent.executor_ref = "forged";
  });
  const planned = await kernel.plan(mission().mission_id, registry);
  assert.equal(planned.state, "PLANNED"); assert.equal(executions, 0); assert.equal(calls.length, 1);
  assert.deepEqual(planned.brain?.plan.goals, proposal().goals);
  verifyBrainPlan(planned);
  assert.equal(planned.brain?.planning_receipt.mode, "model");
  assert.equal(planned.brain?.decision_receipts[1].selection.executor_ref, "builder");
  await kernel.plan(mission().mission_id, registry);
  assert.equal(calls.length, 1);
  assert.equal((await kernel.execute(mission().mission_id, registry)).verdict, "VERIFIED");
  assert.equal(executions, 2);
  const completed = (await kernel.get(mission().mission_id))!;
  verifyCompletedMission(completed);
  assert.equal(completed.brain?.reflection?.recovery, "NONE");
  assert.equal(completed.mission_receipt?.planning_receipt_sha256, planned.brain?.planning_receipt.receipt_sha256);
  assert.equal(completed.mission_receipt?.decisions_root, digest(planned.brain?.decision_receipts));
  assert.equal(completed.mission.requirements[0].expected, "built");
});

test("Brain rejects attempts to mutate graph, capabilities, acceptance or plan shape", async () => {
  const cases = [
    { ...proposal(), status: "COMPLETED" },
    { ...proposal(), requirements: [] },
    { ...proposal(), tasks: [] },
    { ...proposal(), tasks: [proposal().tasks[1], proposal().tasks[0]] },
    { ...proposal(), tasks: proposal().tasks.map((t) => ({ ...t, executor_ref: "shell" })) },
    { ...proposal(), tasks: [proposal().tasks[0], { ...proposal().tasks[1], agent_id: "unknown" }] },
    { ...proposal(), tasks: [proposal().tasks[0], { ...proposal().tasks[1], depends_on: [] }] },
    { ...proposal(), goals: [] },
    { ...proposal(), summary: "x".repeat(4097) },
  ];
  for (const value of cases) {
    const brain = new BrainControlPlane(new ModelBrainPlanner(model(value)));
    const kernel = new MissionKernel(undefined, undefined, brain);
    await kernel.create(mission(), graph);
    let executions = 0;
    await assert.rejects(kernel.execute("mission", executors(() => executions++)), /INVALID_PLAN/);
    assert.equal(executions, 0);
    const record = (await kernel.get("mission"))!;
    assert.equal(record.state, "CREATED"); assert.equal(record.planning?.status, "REJECTED");
    assert.equal(record.brain, undefined); assert.equal(record.verification_receipt, undefined);
  }
});

test("policy denies every configured fallback and task model before memory/model calls", async () => {
  let modelCalls = 0, memoryCalls = 0;
  const planner = new ModelBrainPlanner(model(proposal(), () => modelCalls++), ["openai:brain", "anthropic:backup"]);
  const memory: BrainMemory = { id: "memory", recall: async () => { memoryCalls++; throw new Error("must not call"); } };
  const input = request();
  input.mission.policy = { allowed_executor_refs: ["planner", "builder"], allowed_model_refs: ["openai:brain", "openai:builder"] };
  await assert.rejects(new BrainControlPlane(planner, memory).plan(input), /MODEL_DENIED/);
  input.mission.policy.allowed_model_refs!.push("anthropic:backup");
  input.mission.policy.allowed_executor_refs = ["planner"];
  await assert.rejects(new BrainControlPlane(planner, memory).plan(input), /EXECUTOR_DENIED/);
  assert.equal(modelCalls, 0); assert.equal(memoryCalls, 0);
});

test("invalid context limits and wrong memory scope are rejected before a model call", async () => {
  let calls = 0;
  const planner = new ModelBrainPlanner(model(proposal(), () => calls++));
  const badBudget = request(); badBudget.mission.budget = { max_tasks: 2, max_context_chars: 511 };
  await assert.rejects(new BrainControlPlane(planner).plan(badBudget), /INVALID_CONTEXT_BUDGET/);
  const memory: BrainMemory = { id: "foreign", recall: async (scope) => {
    const body = { scope: { ...scope, organization_id: "foreign" }, brain_id: "brain", ledger_head: "head", text: "memory", references: [], truncated: false };
    return { ...body, context_sha256: digest(body) };
  } };
  await assert.rejects(new BrainControlPlane(planner, memory).plan(request()), /MEMORY_CONTEXT_REJECTED/);
  assert.equal(calls, 0);
});

test("planning claim fences concurrent callers and restart never repeats unresolved model work", async () => {
  const store = new MemoryMissionStore(); let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const planner: BrainPlanner = { id: "blocked", mode: "native", model_refs: [], propose: async () => { calls++; await gate; return { proposal: proposal(), evidence: {} }; } };
  const first = new MissionKernel(store, undefined, new BrainControlPlane(planner));
  await first.create(mission(), graph);
  const pending = first.plan("mission");
  // Let the durable claim and planner call finish before simulating another process.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const restarted = new MissionKernel(store, undefined, new BrainControlPlane(planner));
  await assert.rejects(restarted.plan("mission"), /not available/);
  await assert.rejects(restarted.execute("mission", executors()), /not available/);
  await assert.rejects(restarted.cancel("mission"), /active planning/);
  assert.equal(calls, 1); release(); await pending;
});

test("rejected planning can be explicitly retried without exposing provider error text", async () => {
  let calls = 0;
  const planner: BrainPlanner = { id: "retry", mode: "native", model_refs: [], propose: async () => {
    if (calls++ === 0) throw new Error("a remote response with SUPER_SECRET");
    return { proposal: proposal(), evidence: {} };
  } };
  const kernel = new MissionKernel(undefined, undefined, new BrainControlPlane(planner));
  await kernel.create(mission(), graph);
  await assert.rejects(kernel.plan("mission"), /PLANNING_FAILED/);
  assert.doesNotMatch(JSON.stringify(await kernel.get("mission")), /SUPER_SECRET/);
  const rejectedAttempt = (await kernel.get("mission"))!.planning!.attempt_id;
  const planned = await kernel.plan("mission");
  assert.notEqual(planned.planning?.attempt_id, rejectedAttempt);
  assert.equal(planned.state, "PLANNED"); assert.equal(calls, 2);
});

test("planning and decision tampering, foreign scope and reflection tampering break mission proof", async () => {
  const kernel = new MissionKernel(); await kernel.create(mission(), graph); await kernel.execute("mission", executors());
  const record = (await kernel.get("mission"))!;
  const plan = structuredClone(record); plan.brain!.plan.tasks[1].instruction = "changed";
  assert.throws(() => verifyBrainPlan(plan), /REJECTED/);
  const decisions = structuredClone(record); decisions.brain!.decision_receipts[1].selection.executor_ref = "shell";
  assert.throws(() => verifyBrainPlan(decisions), /REJECTED/);
  const foreign = structuredClone(record); foreign.brain!.planning_receipt.scope.mission_id = "foreign";
  assert.throws(() => verifyBrainPlan(foreign), /REJECTED/);
  const reflection = structuredClone(record); reflection.brain!.reflection!.recovery = "REVIEW_REQUIRED";
  assert.throws(() => verifyCompletedMission(reflection), /binding rejected/);
});

test("reflection records failed requirements and requests review, never automatic success/retry", async () => {
  const kernel = new MissionKernel(); await kernel.create(mission(), graph);
  const registry = executors(); registry.register("builder", () => ({ output: {}, evidence: [] }));
  const run = await kernel.execute("mission", registry);
  const failed = (await kernel.get("mission"))!;
  assert.equal(failed.state, "FAILED"); assert.equal(failed.brain?.reflection?.verdict, "INCOMPLETE");
  assert.deepEqual(failed.brain?.reflection?.failed_requirements, ["built"]);
  assert.equal(failed.brain?.reflection?.proof_receipt_sha256, run.proof.receipt_sha256);
  assert.equal(failed.brain?.reflection?.recovery, "REVIEW_REQUIRED");
  assert.equal(failed.mission_receipt, undefined);
});

test("configured brain fails closed and its description has no token or origin", () => {
  assert.throws(() => createConfiguredBrain({ OSA_BRAIN_MODE: "auto" }), /native or model/);
  assert.throws(() => createConfiguredBrain({ OSA_BRAIN_MODE: "model" }), /provider/);
  assert.throws(() => createConfiguredBrain({ OSA_NEUROSA_TOKEN: "x".repeat(24) }), /all origin/);
  const brain = createConfiguredBrain({ OSA_NEUROSA_BASE_URL: "https://private.example", OSA_NEUROSA_TOKEN: "SECRET_TOKEN".repeat(3),
    OSA_NEUROSA_BRAIN_ID: "brain", OSA_NEUROSA_ORGANIZATION_ID: "org", OSA_NEUROSA_PROJECT_ID: "project" });
  assert.doesNotMatch(JSON.stringify(brain.describe()), /SECRET_TOKEN|private.example/);
  assert.equal(brain.describe().mode, "native");
});

test("NeurOSA memory rejects unsafe origins, wrong tenant and invalid ledger/context", async () => {
  const options = { baseUrl: "https://brain.example", token: "x".repeat(24), brainId: "brain", organizationId: "org", projectId: "project" };
  for (const baseUrl of ["http://brain.example", "https://user:password@brain.example", "https://brain.example?token=x", "https://brain.example/path"]) assert.throws(() => new NeurosaMemoryAdapter({ ...options, baseUrl }));
  let requests = 0;
  const adapter = new NeurosaMemoryAdapter({ ...options, fetch: async () => { requests++; return new Response(JSON.stringify({ brainId: "brain", ledgerValid: false })); } });
  await assert.rejects(adapter.recall({ organization_id: "foreign", project_id: "project", mission_id: "mission" }, "objective", 512), /SCOPE_DENIED/);
  assert.equal(requests, 0);
  await assert.rejects(adapter.recall({ organization_id: "org", project_id: "project", mission_id: "mission" }, "objective", 512), /LEDGER_REJECTED/);
  for (const invalid of [{ brainId: "foreign" }, { text: "x".repeat(513) }, { ledgerValid: false }, { ledgerHead: "" }]) {
    const bad = new NeurosaMemoryAdapter({ ...options, fetch: async (url) => new Response(JSON.stringify(String(url).endsWith("status") ?
      { brainId: "brain", ledgerValid: true } : { brainId: "brain", ledgerValid: true, ledgerHead: "head", text: "memory", references: [], truncated: false, ...invalid })) });
    await assert.rejects(bad.recall({ organization_id: "org", project_id: "project", mission_id: "mission" }, "objective", 512), /CONTEXT_REJECTED/);
  }
});

test("NeurOSA response size is bounded and remote error text never escapes", async () => {
  const options = { baseUrl: "https://brain.example", token: "x".repeat(24), brainId: "brain", organizationId: "org", projectId: "project" };
  const scope = { organization_id: "org", project_id: "project", mission_id: "mission" };
  const huge = new NeurosaMemoryAdapter({ ...options, fetch: async () => new Response("x".repeat(1024 * 1024 + 1)) });
  await assert.rejects(huge.recall(scope, "objective", 512), /RESPONSE_TOO_LARGE/);
  const denied = new NeurosaMemoryAdapter({ ...options, fetch: async () => new Response("SUPER_SECRET", { status: 403 }) });
  await assert.rejects(denied.recall(scope, "objective", 512), (error: Error) => error.message === "NEUROSA_UNAVAILABLE");
});

test("unknown model routing and malformed JSON cannot produce a planning receipt", async () => {
  const provider = model();
  const unknown: ModelProvider = { ...provider, complete: async (request) => ({ ...await provider.complete(request), provider: "unconfigured" }) };
  await assert.rejects(new BrainControlPlane(new ModelBrainPlanner(unknown)).plan(request()), /UNCONFIGURED_BRAIN_MODEL/);
  const malformed: ModelProvider = { ...provider, complete: async (request) => ({ ...await provider.complete(request), text: "not JSON" }) };
  await assert.rejects(new BrainControlPlane(new ModelBrainPlanner(malformed)).plan(request()), /INVALID_PLAN/);
  const alias: ModelProvider = { ...provider, complete: async (request) => ({ ...await provider.complete(request), model: "brain-resolved-version" }) };
  const resolved = await new BrainControlPlane(new ModelBrainPlanner(alias)).plan(request());
  assert.equal(resolved.planning_receipt.evidence.configured_model_ref, "openai:brain");
  assert.equal(resolved.planning_receipt.evidence.model, "brain-resolved-version");
});

test("native Brain is a graph compiler and does not pretend to perform semantic decomposition", async () => {
  const result = await new BrainControlPlane(new NativeBrainPlanner()).plan(request());
  assert.equal(result.planning_receipt.mode, "native");
  assert.deepEqual(result.plan.goals, [mission().objective]);
  assert.equal(result.plan.risk, "UNASSESSED");
  assert.deepEqual(result.planning_receipt.model_refs, []);
});

test("oversized control-plane input is refused before network calls", async () => {
  let calls = 0;
  const input = request(); input.mission.input = "x".repeat(512 * 1024);
  await assert.rejects(new BrainControlPlane(new ModelBrainPlanner(model(proposal(), () => calls++))).plan(input), /BRAIN_INPUT_TOO_LARGE/);
  assert.equal(calls, 0);
});

test("direct runtime rejects foreign/tampered pinned plans before an agent can run", async () => {
  const result = await new BrainControlPlane().plan(request());
  let calls = 0;
  const registry = executors(() => calls++);
  const foreign = structuredClone(result.plan); foreign.scope.mission_id = "foreign";
  await assert.rejects(new OsaRuntime(registry, { missionPlan: foreign }).run(graph, mission()), /RUNTIME_PLAN_REJECTED/);
  const denied = structuredClone(result.plan); denied.tasks[1].executor_ref = "shell";
  await assert.rejects(new OsaRuntime(registry, { missionPlan: denied }).run(graph, mission()), /RUNTIME_PLAN_REJECTED/);
  assert.equal(calls, 0);
});

test("supplied task dependencies cannot override canonical handoffs in the control plane", async () => {
  const input = request(); input.task_graph.nodes[1].depends_on = [];
  await assert.rejects(new BrainControlPlane().plan(input), /INVALID_PLAN/);
});
