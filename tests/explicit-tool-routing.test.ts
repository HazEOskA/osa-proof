import test from "node:test";
import assert from "node:assert/strict";
import { selectExplicitToolCommand } from "../packages/contracts/src/explicit-tool-routing";
import { selectUnifiedTool } from "../apps/api/src/unified";

const supervisorP0Prompt = `TEST SUPERVISOR P0 — WORKER → SUPERVISOR → APR

Oblicz niezależnie trzy działania. Każde przedstaw w jednej linii jako pełne równanie: wyrażenie = wynik.

1. 81 000 - 30 000 - 53 000 - 8 000 - 2 000
2. 18 000 - 30 000
3. 7 × 8 - 6

Wyjaśnij krótko znak wyniku w dwóch pierwszych działaniach.

Nie deklaruj, że uruchomiłeś Supervisor, APR, narzędzia albo testy. Weryfikację wykonania sprawdzę samodzielnie w śladzie i bundle OSA Proof. Odpowiadaj wyłącznie po polsku.`;

test("routing regression: exact Supervisor P0 prompt remains a conversation",()=>{
  assert.equal(selectExplicitToolCommand(supervisorP0Prompt),null);
  assert.equal(selectUnifiedTool(supervisorP0Prompt),"osa.unified.blocked.v1");
  assert.equal(selectExplicitToolCommand("Weryfikację wykonania sprawdzę samodzielnie w śladzie i bundle OSA Proof."),null);
});
test("routing: explicit standalone existing tool commands still work both on client and API",()=>{
  const cases:[string,string][]=[
    ["Oblicz SHA-256 tekstu: OSA Proof","osa.crypto.sha256.v1"],
    ["policz sha256: przykład","osa.crypto.sha256.v1"],
    ["Oblicz SHA-256 tekstu: pierwsza linia\nnastępna linia","osa.crypto.sha256.v1"],
    ["Sprawdź skonfigurowane repozytorium read-only.","osa.worker.repo.inspect.v1"],
    ["Status workera","osa.worker.health.v1"],
    ["Pokaż status workera","osa.worker.health.v1"],
    ["Zdrowie hosta","osa.worker.health.v1"],
    ["Sprawdź status runtime OSA Proof","osa.runtime.inspect.v1"],
    ["Pokaż status runtime","osa.runtime.inspect.v1"],
    ["Status runtime","osa.runtime.inspect.v1"],
    ["Diagnostyka API","osa.runtime.inspect.v1"],
    ["sprawdź osa proof","osa.runtime.inspect.v1"],
  ];
  for(const [message,ref] of cases){
    assert.equal(selectExplicitToolCommand(message),ref,message);
    assert.equal(selectUnifiedTool(message),ref,message);
  }
});
test("routing: incidental tool words, quotes, and instructions embedded in conversation do not execute tools",()=>{
  for(const message of [
    "W odpowiedzi opiszę, jak sprawdzę status runtime OSA Proof.",
    "Jakie są zalety funkcji runtime.inspect w architekturze?",
    "Proszę sprawdź status runtime OSA Proof i pomóż mi to zrozumieć.",
    "Sprawdź status runtime OSA Proof, a potem rozwiąż moje zadanie matematyczne.",
    "Sprawdź status runtime OSA Proof\nNastępnie oblicz 2+2.",
    "TEST: Sprawdź status runtime OSA Proof",
    'W cytacie jest "Pokaż status runtime", ale to tylko przykład.',
    "Czy status workera wpływa na LLM?",
    "Wytłumacz mi status workera.",
    "Jaki jest status workera?",
    "Oblicz 81 000 - 30 000 - 53 000 - 8 000 - 2 000",
    "Weryfikację sprawdzę samodzielnie w bundle OSA Proof",
    "Pokaż mi status API i odpowiedz na inne pytania",
    "  ",
  ]){
    assert.equal(selectExplicitToolCommand(message),null,message);
    assert.equal(selectUnifiedTool(message),"osa.unified.blocked.v1",message);
  }
});
