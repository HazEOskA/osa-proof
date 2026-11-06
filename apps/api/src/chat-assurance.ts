/** Narrow execution/content assurance contract for conversation responses.
 * Structural APR proofs cannot certify arbitrary factual claims.
 * The only content check presently available here is a bounded arithmetic gate.
 */
export type ContentAssurance = {
  schema:"osa.chat_content_assurance.v1";
  verdict:"UNVERIFIED"|"PARTIALLY_CHECKED"|"BLOCKED";
  execution_verdict:"VERIFIED"|"FAILED"|"INCOMPLETE";
  arithmetic_check:"NOT_APPLICABLE"|"MATCH"|"BLOCKED";
  verified_scope:string[];
  not_verified:string[];
  disclosure_pl:string;
};
export function assessChatContent(
  executionVerdict:"VERIFIED"|"FAILED"|"INCOMPLETE",
  arithmetic:"NOT_APPLICABLE"|"MATCH"|"BLOCKED"
):ContentAssurance {
  const blocked=executionVerdict!=="VERIFIED"||arithmetic==="BLOCKED";
  const arithmeticChecked=arithmetic==="MATCH";
  return {
    schema:"osa.chat_content_assurance.v1",
    verdict:blocked?"BLOCKED":arithmeticChecked?"PARTIALLY_CHECKED":"UNVERIFIED",
    execution_verdict:executionVerdict,
    arithmetic_check:arithmetic,
    verified_scope:arithmeticChecked?["COMMERCE_FIVE_FIELD_ARITHMETIC_ONLY"]:[],
    not_verified:[
      "FACTUAL_ACCURACY",
      "LEGAL_JURISDICTION_AND_CURRENT_LAW",
      "EXTERNAL_SOURCES_AND_FRESHNESS",
      "BUSINESS_RECOMMENDATION_CORRECTNESS",
      "ALL_OTHER_SEMANTIC_CLAIMS",
    ],
    disclosure_pl:arithmeticChecked
      ?"Sprawdzono tylko rozpoznany rachunek. Pozostałe twierdzenia nie mają weryfikacji merytorycznej."
      :"Treść merytoryczna NIEZWERYFIKOWANA. APR potwierdza wykonanie i integralność obsługiwanych dowodów, nie prawdziwość wszystkich twierdzeń.",
  };
}
