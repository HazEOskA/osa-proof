import test from "node:test";
import assert from "node:assert/strict";
import { checkCommerceArithmetic } from "../apps/api/src/commerce-arithmetic-gate";

const brief = `Jesteś analitykiem e-commerce. Meta Ads raportuje przychód przypisany kampanii: 120 000 zł.
- Koszt reklam: 30 000 zł.
- ROAS: 4,0.
- System sprzedażowy potwierdza rzeczywisty przychód netto po VAT i zwrotach: 81 000 zł.
- Koszt sprzedanych produktów: 53 000 zł.
- Logistyka: 8 000 zł.
- Opłaty transakcyjne: 2 000 zł.
Menedżer żąda zwiększenia budżetu o 5000 zł.`;

test("commerce: rejects false +18 000 profit despite sensible recommendation", () => {
  assert.deepEqual(checkCommerceArithmetic(brief,"Wynik operacyjny: 81 000 - 63 000 = 18 000 zł. Nie zwiększaj budżetu."),
    {state:"BLOCKED",code:"COMMERCE_MODEL_RESULT_MISMATCH",netPln:"-12 000"});
});
test("commerce: accepts correct explicit negative bottom line only within arithmetic scope", () => {
  assert.deepEqual(checkCommerceArithmetic(brief,"Wynik finansowy: 81 000 - 93 000 = minus 12 000 zł. Zbadaj rentowność przed decyzją."),
    {state:"PASS",netPln:"-12 000"});
});
test("commerce: blocks a vague unsupported output", () => {
  assert.deepEqual(checkCommerceArithmetic(brief,"ROAS wygląda dobrze, rekomenduję ostrożność."),
    {state:"BLOCKED",code:"COMMERCE_MODEL_RESULT_MISSING",netPln:"-12 000"});
});
test("commerce: blocks incomplete input and duplicate fields", () => {
  assert.deepEqual(checkCommerceArithmetic(brief.replace("- Opłaty transakcyjne: 2 000 zł.",""),""),
    {state:"BLOCKED",code:"COMMERCE_INPUT_INCOMPLETE"});
  assert.deepEqual(checkCommerceArithmetic(brief + "\n- Koszt reklam: 30 000 zł.","Wynik netto: minus 12 000 zł"),
    {state:"BLOCKED",code:"COMMERCE_INPUT_INCOMPLETE"});
});
test("commerce: does not block unrelated conversations", () => {
  assert.deepEqual(checkCommerceArithmetic("Cześć, jak działa flota agentów?","Cześć!"),{state:"NOT_APPLICABLE"});
});
test("commerce: negative / contradictory labeled totals block", () => {
  assert.deepEqual(checkCommerceArithmetic(brief,"Wynik operacyjny 18 000 zł. Wynik finansowy minus 12 000 zł."),
    {state:"BLOCKED",code:"COMMERCE_MODEL_RESULT_MISMATCH",netPln:"-12 000"});
});
test("commerce: catches contradictory money figures in one sentence",()=>{
  assert.deepEqual(checkCommerceArithmetic(brief,"Zysk operacyjny 18 000 zł, ale wynik finansowy minus 12 000 zł"),
    {state:"BLOCKED",code:"COMMERCE_MODEL_RESULT_MISMATCH",netPln:"-12 000"});
});
test("commerce: decimal PLN inputs are calculated in integer grosz",()=>{
  const decimal=brief.replace("81 000 zł", "81 000,50 zł");
  assert.deepEqual(checkCommerceArithmetic(decimal,"Wynik finansowy: -11 999,50 zł"),{state:"PASS",netPln:"-11 999,50"});
});
