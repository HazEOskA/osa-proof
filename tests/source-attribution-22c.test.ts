import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import test from "node:test";
import type { Mission, TeamGraph } from "../packages/contracts/src";
import { digest, verifyProofReceipt } from "../packages/proof-core/src";
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
  assert.equal(run.tool_calls?.length, 0);
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
      item.requirement_id === "__claim_attribution__" &&
      item.verdict === "FAILED" && item.reason === "CLAIM_UNSUPPORTED"
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


async function withWeatherServer<T>(temp: number, fn: (url: string, count: () => number) => Promise<T>): Promise<T> {
  let requests = 0;
  const server: Server = createServer((request, response) => {
    requests += 1;
    if (request.method !== "GET" || request.url !== "/temperatura") {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, {"content-type":"application/json"});
    response.end(JSON.stringify({temperature_celsius: temp}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Brak portu serwera testowego");
  try {
    return await fn("http://127.0.0.1:" + address.port + "/temperatura", () => requests);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function runWeatherReport(apiTemp: number, reportTemp: number) {
  return withWeatherServer(apiTemp, async (url, count) => {
    const graph: TeamGraph = {
      organization_id:"org_weather",project_id:"project_weather",team_id:"team_weather",version:"1",
      agents:[{agent_id:"reporter",role:"reporter",executor_ref:"reporter.v1",tool_capabilities:["weather.current.v1"]}],
      edges:[],
    };
    const mission: Mission = {
      organization_id:graph.organization_id,project_id:graph.project_id,team_id:graph.team_id,
      team_version:graph.version,mission_id:"weather_report_"+reportTemp,objective:"Sprawdź pogodę przez zewnętrzne API",
      entry_agent_id:"reporter",input:{request:"odczyt temperatury"},
      requirements:[{requirement_id:"report_built",type:"evidence_field_equals",evidence_kind:"artifact",agent_id:"reporter",field:"status",expected:"built"}],
    };
    const registry = new ExecutorRegistry();
    registry.registerTool("weather.current.v1", async () => {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      return response.json() as Promise<{temperature_celsius:number}>;
    });
    registry.register("reporter.v1", async ({callTool}) => {
      assert.ok(callTool, "wywołanie przechodzi wyłącznie przez runtime gateway");
      const result = await callTool("weather.current.v1", {city:"TEST"});
      assert.deepEqual(result, {temperature_celsius:apiTemp});
      const report = "Aktualna temperatura wynosi " + reportTemp + "°C.";
      const content_sha256 = createHash("sha256").update(report, "utf8").digest("hex");
      return {
        output:{report,temperature_celsius:reportTemp},
        evidence:[{kind:"artifact",data:{status:"built",content_sha256},content:report}],
      };
    });
    const run = await new OsaRuntime(registry,{
      clock:() => new Date("2026-10-31T03:00:00.000Z"),
      createExecutionId:() => "exec_33333333-3333-4333-8333-333333333333",
    }).run(graph,mission);
    return {run,requests:count()};
  });
}

test("PASS: prawdziwy HTTP 200 22°C, zgodny raport, hash odpowiedzi zapisany przez runtime", async () => {
  const {run,requests} = await runWeatherReport(22,22);
  assert.equal(requests, 1, "test musi naprawdę wykonać żądanie HTTP");
  assert.equal(run.tool_calls?.length, 1);
  assert.equal(run.tool_calls![0].tool_ref, "weather.current.v1");
  assert.equal(run.tool_calls![0].response_sha256,digest({temperature_celsius:22}));
  assert.equal(run.proof.egress_status, "NOT_ENFORCED");
  assert.equal(run.proof.signature_status, "UNAVAILABLE");
  assert.deepEqual(
    verifyProofReceipt({receipt:run.proof,evidence:run.evidence,observations:run.observations,final_output:run.final_output,tool_calls:run.tool_calls}),
    {ok:true,errors:[]}
  );
  assert.equal(run.verdict, "VERIFIED");
  assert.equal(run.proof.requirement_verdicts.find(item=>item.requirement_id==="__claim_attribution__")?.reason,"SOURCE_ATTRIBUTION_VERIFIED");
  assert.ok(run.events.some(event=>event.type==="TOOL_CALL_STARTED"));
  assert.ok(run.events.some(event=>event.type==="TOOL_CALL_COMPLETED"));
  assert.ok(run.events.some(event=>event.type==="CLAIM_ATTRIBUTION_CHECKED"&&event.payload.status==="SUPPORTED"));
  assert.ok(run.events.some(event=>event.type==="RUN_VERIFIED"));
});

test("FAIL: API zwraca 22°C, agent twierdzi 25°C — deterministyczny mismatch", async () => {
  const {run,requests}=await runWeatherReport(22,25);
  assert.equal(requests,1);
  assert.equal(run.tool_calls?.length,1);
  assert.equal(run.verdict,"FAILED");
  assert.equal(run.proof.requirement_verdicts.find(item=>item.requirement_id==="__claim_attribution__")?.reason,"CLAIM_VALUE_MISMATCH");
  assert.ok(run.events.some(event=>event.type==="CLAIM_ATTRIBUTION_CHECKED"&&event.payload.reason_code==="CLAIM_VALUE_MISMATCH"));
  assert.ok(run.events.some(event=>event.type==="RUN_FAILED"));
});

test("PASS: zwykła aplikacja do zadań, liczby w raporcie nie są faktami zewnętrznymi",async()=>{
  const graph:TeamGraph={
    organization_id:"org_tasks",project_id:"project_tasks",team_id:"team_tasks",version:"1",
    agents:[{agent_id:"builder",role:"builder",executor_ref:"builder.v1"}],edges:[],
  };
  const mission:Mission={
    organization_id:graph.organization_id,project_id:graph.project_id,team_id:graph.team_id,
    team_version:graph.version,mission_id:"tasks_app",objective:"Zbuduj aplikację do zadań",
    entry_agent_id:"builder",input:{features:3},
    requirements:[{requirement_id:"built",type:"evidence_field_equals",evidence_kind:"artifact",field:"status",expected:"built"}],
  };
  const registry = new ExecutorRegistry();
  registry.register("builder.v1",()=>({output:{report:"Zbudowano aplikację do zadań z 3 widokami. Wersja 2.0."},evidence:[{kind:"artifact",data:{status:"built"}}]}));
  const run=await new OsaRuntime(registry).run(graph,mission);
  assert.equal(run.verdict,"VERIFIED");
  assert.equal(run.proof.claim_attribution,undefined,"brak wymagania dotyczącego źródła zewnętrznego");
});

test("FAIL: nawet HTTP 200 nie potwierdza deklaracji wykonanej integracji API",async()=>{
  const {run}=await withWeatherServer(22,async(url)=>{
    const graph:TeamGraph={organization_id:"org_int",project_id:"project_int",team_id:"team_int",version:"1",
      agents:[{agent_id:"reporter",role:"reporter",executor_ref:"reporter.v1",tool_capabilities:["weather.current.v1"]}],edges:[]};
    const mission:Mission={organization_id:graph.organization_id,project_id:graph.project_id,team_id:graph.team_id,
      team_version:graph.version,mission_id:"integration_claim",objective:"Sprawdź temperaturę przez zewnętrzne API",
      entry_agent_id:"reporter",input:{},requirements:[{requirement_id:"built",type:"evidence_field_equals",evidence_kind:"artifact",field:"status",expected:"built"}]};
    const registry=new ExecutorRegistry();
    registry.registerTool("weather.current.v1",async()=>{const r=await fetch(url);return r.json();});
    registry.register("reporter.v1",async({callTool})=>{await callTool!("weather.current.v1",{});return {
      output:{report:"Zintegrowałem zewnętrzne API. Temperatura wynosi 22°C."},
      evidence:[{kind:"artifact",data:{status:"built"}}],
    };});
    const run=await new OsaRuntime(registry).run(graph,mission);
    return {run};
  });
  assert.equal(run.tool_calls?.length,1);
  assert.equal(run.verdict,"FAILED");
  assert.equal(run.proof.requirement_verdicts.find(item=>item.requirement_id==="__claim_attribution__")?.reason,"CLAIM_UNSUPPORTED");
});
