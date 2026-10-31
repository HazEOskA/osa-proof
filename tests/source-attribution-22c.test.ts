import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Mission, TeamGraph } from "../packages/contracts/src";
import { verifyProofReceipt } from "../packages/proof-core/src";
import { ExecutorRegistry, OsaRuntime } from "../packages/runtime/src";

/**
 * Regresja 22°C: agent nie może otrzymać VERIFIED tylko dlatego, że
 * poprawnie zahaszował własne, nieudokumentowane twierdzenie.
 *
 * To test RED/TDD. Nie symulujemy wyniku verifiera ani awarii runtime:
 * uruchamiamy prawdziwy OsaRuntime i świadomie nie rejestrujemy żadnego
 * wywołania zewnętrznego API ani jego odpowiedzi.
 */
test("22°C: twierdzenie o integracji API bez wywołania musi automatycznie zakończyć się FAIL", async () => {
  const claim = "Zintegrowałem zewnętrzne API. Aktualna temperatura wynosi 22°C.";
  const contentSha256 = createHash("sha256").update(claim, "utf8").digest("hex");

  const graph: TeamGraph = {
    organization_id: "org_attribution_22c",
    project_id: "project_attribution_22c",
    team_id: "team_attribution_22c",
    version: "1",
    agents: [
      {
        agent_id: "reporter",
        role: "reporter",
        executor_ref: "reporter.untrusted.v1",
      },
    ],
    edges: [],
  };
  const mission: Mission = {
    organization_id: graph.organization_id,
    project_id: graph.project_id,
    team_id: graph.team_id,
    team_version: graph.version,
    mission_id: "mission_source_attribution_22c",
    objective: "Sprawdź temperaturę przez zewnętrzne API i przedstaw raport ze źródłem",
    entry_agent_id: "reporter",
    input: { request: "temperatura z zewnętrznego API" },
    requirements: [
      {
        requirement_id: "report_built",
        type: "evidence_field_equals",
        evidence_kind: "artifact",
        agent_id: "reporter",
        field: "status",
        expected: "built",
      },
    ],
  };

  // Jedyny wykonawca produkuje twierdzenie, NIE wywołanie API.
  // Brak adaptera sieciowego i brak odpowiedzi tool/API w dowodach.
  const registry = new ExecutorRegistry();
  registry.register("reporter.untrusted.v1", () => ({
    output: {
      report: claim,
      temperature_celsius: 22,
      claimed_external_api_integration: true,
    },
    evidence: [{
      kind: "artifact",
      data: {
        status: "built",
        content_sha256: contentSha256,
      },
      content: claim,
    }],
  }));

  const run = await new OsaRuntime(registry, {
    clock: () => new Date("2026-10-31T03:00:00.000Z"),
    createExecutionId: () => "exec_22222222-2222-4222-8222-222222222222",
  }).run(graph, mission);

  // Warunki wejścia: wykonawca skończył, integralność jest poprawna,
  // a żaden zapis narzędzia ani odpowiedzi API nie istnieje.
  assert.ok(run.events.some((event) => event.type === "AGENT_COMPLETED"));
  assert.ok(!run.events.some((event) => event.type === "AGENT_FAILED"));
  assert.equal(run.proof.runtime_failure, undefined);
  assert.ok(run.evidence.some((evidence) => evidence.kind === "artifact"));
  assert.equal(
    run.evidence.filter((evidence) =>
      /(?:^|_)(?:tool_call|tool_response|api_call|api_response)(?:$|_)/i.test(evidence.kind)
    ).length,
    0,
    "Scenariusz nie może dostarczać dowodu wywołania API"
  );
  assert.deepEqual(
    verifyProofReceipt({
      receipt: run.proof,
      evidence: run.evidence,
      observations: run.observations,
      final_output: run.final_output,
    }),
    { ok: true, errors: [] },
    "Integralność dowodu musi przejść niezależnie od prawdziwości twierdzenia"
  );

  // Oczekiwany wynik przyszłego Attribution Gate: automatyczna odmowa,
  // mimo poprawnej integralności artefaktu i sukcesu samego wykonawcy.
  assert.equal(
    run.verdict,
    "FAILED",
    "P0: brak wywołania API nie może dawać VERIFIED dla twierdzenia o 22°C"
  );
  assert.equal(run.proof.verdict, "FAILED");
  assert.ok(
    run.proof.requirement_verdicts.some((item) =>
      item.verdict === "FAILED" &&
      /CLAIM_UNSUPPORTED|SOURCE_ATTRIBUTION_MISSING|TOOL_CALL_MISSING|UNVERIFIED_SOURCE/i.test(item.reason)
    ),
    "FAIL musi wynikać z braku źródła, nie z przypadkowej awarii runtime"
  );
  assert.ok(
    run.events.some((event) =>
      event.type === "VERIFICATION_FAILED" && event.payload.proof_id === run.proof.proof_id
    ),
    "Replay musi zawierać odrzucenie związane z zapieczętowanym Proof Receipt"
  );
  assert.ok(
    run.events.some((event) =>
      event.type === "RUN_FAILED" && event.payload.proof_id === run.proof.proof_id
    ),
    "Replay musi zawierać końcowe zdarzenie FAIL"
  );
});
