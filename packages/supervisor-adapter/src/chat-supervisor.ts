import { createHash } from "node:crypto";

/** Bounded domain-neutral checks on explicit numeric equalities.
 * Unknown claims remain UNKNOWN: arithmetic PASS is not general factual proof.
 */
export type SupervisorVerdict = "PASS" | "FAIL" | "UNKNOWN";
export interface SupervisorCheck {
  expression_sha256: string;
  expression: string;
  verdict: SupervisorVerdict;
  expected: string | null;
  observed: string | null;
  reason: "ARITHMETIC_MATCH" | "ARITHMETIC_MISMATCH" | "UNSUPPORTED_EXPRESSION";
}
export interface SupervisorReview {
  schema: "osa.chat_supervisor_review.v1";
  response_sha256: string;
  verdict: SupervisorVerdict;
  scope: "EXPLICIT_ARITHMETIC_EQUALITIES_ONLY";
  checks: SupervisorCheck[];
  limitations: string[];
}
export interface SupervisorAttempt {
  attempt: number;
  response_sha256: string;
  provider_response_id: string | null;
  review: SupervisorReview;
}
export interface SupervisorRelease {
  schema: "osa.chat_supervisor_release.v1";
  decision: "RELEASED" | "REJECTED";
  publishable: boolean;
  verification_scope: "EXPLICIT_ARITHMETIC_EQUALITIES_ONLY";
  content_verdict: "PASS" | "FAIL" | "UNKNOWN";
  final_response_sha256: string;
  attempts: SupervisorAttempt[];
  repair_count: number;
  reason_code: "CHECKED" | "UNVERIFIED_CONTENT" | "REPAIR_EXHAUSTED";
}
const sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
const num="(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d+)?";
const signed="[+\\-−–]?\\s*"+num;
const unit="(?:\\s*(?:zł|PLN|EUR|USD|€|\\$))?";
const op="[+\\-−–×*/÷]";
const exprPattern=new RegExp("("+signed+unit+"(?:\\s*"+op+"\\s*"+signed+unit+"){1,8})\\s*=\\s*("+signed+")","giu");
const firstNumber=new RegExp("^"+num,"u");

function numeric(value:string):number|undefined {
  const v=Number(value.replace(/[ \u00a0\u202f]/g,"").replace(",","."));
  return Number.isFinite(v)&&Math.abs(v)<1e14?v:undefined;
}
function parseExpression(source:string):{result:number;hasDivision:boolean}|undefined {
  const expr=source.replace(/[−–]/g,"-").replace(/[×]/g,"*").replace(/[÷]/g,"/");
  let index=0;
  const values:number[]=[];
  const operators:string[]=[];
  const skip=()=>{while(index<expr.length&&/\s/u.test(expr[index]))index++;};
  const operand=():number|undefined=>{
    skip();
    let sign=1;
    if(expr[index]==="+"||expr[index]==="-") {if(expr[index]==="-")sign=-1;index++;}
    skip();
    const n=firstNumber.exec(expr.slice(index));
    if(!n)return;
    index+=n[0].length;
    const value=numeric(n[0]);if(value===undefined)return;
    skip();
    const suffix=/^(?:zł|PLN|EUR|USD|€|\$)/iu.exec(expr.slice(index));
    if(suffix)index+=suffix[0].length;
    return sign*value;
  };
  const first=operand();if(first===undefined)return;
  values.push(first);
  while(index<expr.length){
    skip();if(index>=expr.length)break;
    const operator=expr[index];
    if(!"+-*/".includes(operator))return;
    index++;
    const next=operand();if(next===undefined)return;
    operators.push(operator);values.push(next);
    if(operators.length>8)return;
  }
  if(!operators.length)return;
  const pending:number[]=[values[0]],reduced:string[]=[];
  let hasDivision=false;
  for(let i=0;i<operators.length;i++){
    const o=operators[i],v=values[i+1];
    if(o==="*"||o==="/"){
      if(o==="/"&&v===0)return;
      if(o==="/")hasDivision=true;
      pending[pending.length-1]=o==="*"?pending[pending.length-1]*v:pending[pending.length-1]/v;
    } else {reduced.push(o);pending.push(v);}
  }
  let result=pending[0];
  for(let i=0;i<reduced.length;i++)result=reduced[i]==="+"?result+pending[i+1]:result-pending[i+1];
  return Number.isFinite(result)?{result,hasDivision}:undefined;
}
export function reviewChatCandidate(text:string):SupervisorReview {
  if(typeof text!=="string"||text.length>40000)throw Error("SUPERVISOR_OUTPUT_INVALID");
  const checks:SupervisorCheck[]=[];
  exprPattern.lastIndex=0;
  for(const match of text.matchAll(exprPattern)){
    if(checks.length>=16)break;
    const expression=match[0],parsed=parseExpression(match[1]);
    const rhs=match[2].replace(/[−–]/g,"-").replace(/\s/g,"");
    const observed=numeric(rhs);
    const decimals=(rhs.split(/[.,]/)[1]??"").length;
    const tolerance=parsed?.hasDivision?Math.max(1e-9,Math.pow(10,-decimals)/2+1e-10):
      Math.max(1e-8,Math.abs(parsed?.result??0)*1e-10);
    const verdict:SupervisorVerdict=!parsed||observed===undefined?"UNKNOWN":
      Math.abs(parsed.result-observed)<=tolerance?"PASS":"FAIL";
    checks.push({
      expression_sha256:sha(expression),expression,verdict,
      expected:parsed?String(parsed.result):null,observed:observed===undefined?null:String(observed),
      reason:verdict==="PASS"?"ARITHMETIC_MATCH":verdict==="FAIL"?"ARITHMETIC_MISMATCH":"UNSUPPORTED_EXPRESSION",
    });
  }
  const verdict:SupervisorVerdict=checks.some(x=>x.verdict==="FAIL")?"FAIL":
    checks.length>0&&checks.every(x=>x.verdict==="PASS")?"PASS":"UNKNOWN";
  return {schema:"osa.chat_supervisor_review.v1",response_sha256:sha(text),verdict,
    scope:"EXPLICIT_ARITHMETIC_EQUALITIES_ONLY",checks,
    limitations:[
      "Tylko jawne równania arytmetyczne; brak kontroli niejawnych rachunków, prawa i faktów.",
      "PASS dotyczy wyłącznie wymienionych równań, nie całej wypowiedzi.",
      "Brak sprawdzalnego dowodu oznacza UNKNOWN, nie potwierdzenie treści.",
    ]};
}
export function supervisorRepairFeedback(review:SupervisorReview):string {
  const failures=review.checks.filter(x=>x.verdict==="FAIL").slice(0,4);
  if(review.verdict!=="FAIL"||!failures.length)throw Error("SUPERVISOR_NO_REPAIR_SIGNAL");
  return failures.map(x=>"NIEZGODNE równanie: "+x.expression.slice(0,180)+
    ". Poprawny wynik wyrażenia: "+x.expected+". Popraw odpowiedź na oryginalne pytanie.").join("\n").slice(0,1100);
}
export function sealSupervisorRelease(attempts:SupervisorAttempt[],finalText:string):SupervisorRelease {
  if(!attempts.length||attempts.length>2)throw Error("SUPERVISOR_ATTEMPTS_LIMIT");
  if(attempts.some((a,i)=>a.attempt!==i+1||a.response_sha256!==a.review.response_sha256)||
      sha(finalText)!==attempts[attempts.length-1].response_sha256)throw Error("SUPERVISOR_ATTEMPTS_INTEGRITY");
  const finalReview=attempts[attempts.length-1].review;
  const publishable=finalReview.verdict!=="FAIL";
  return {schema:"osa.chat_supervisor_release.v1",decision:publishable?"RELEASED":"REJECTED",
    publishable,verification_scope:"EXPLICIT_ARITHMETIC_EQUALITIES_ONLY",
    content_verdict:finalReview.verdict,final_response_sha256:sha(finalText),
    attempts,repair_count:attempts.length-1,
    reason_code:!publishable?"REPAIR_EXHAUSTED":finalReview.verdict==="PASS"?"CHECKED":"UNVERIFIED_CONTENT"};
}
