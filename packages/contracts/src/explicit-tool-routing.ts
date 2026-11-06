/** A single, browser-safe source of truth for *explicit* native tool commands.
 *
 * Normal conversation (including quoted instructions, explanations, test
 * descriptions and multi-line prompts) must NEVER trigger a native tool.
 * The provider/model-selected tool path has its own policy and is not routed
 * through this user-message classifier.
 */
export type ExplicitToolRef =
  | "osa.crypto.sha256.v1"
  | "osa.worker.repo.inspect.v1"
  | "osa.worker.health.v1"
  | "osa.runtime.inspect.v1";

const SHA256 = /^(?:oblicz|policz|wylicz)\s+sha-?256(?:\s+tekstu)?\s*:[\s\S]*$/i;
const REPOSITORY = /^sprawdź skonfigurowane repozytorium read-only\.?$/i;
const WORKER = /^(?:(?:pokaż|pokaz|sprawdź|sprawdz)\s+)?(?:status|zdrowie|health)\s+(?:workera|worker|hosta)[.!?]?$/i;
const RUNTIME = /^(?:(?:sprawdź|sprawdz|pokaż|pokaz|zbadaj)\s+(?:(?:aktualny)\s+)?(?:status\s+)?|(?:status|diagnostyka)\s+)(?:runtime(?:\s+osa proof)?|osa proof|narzędzi|narzedzi|narzędzia|narzedzia|api)[.!?]?$/i;

export function selectExplicitToolCommand(message: string): ExplicitToolRef | null {
  if (typeof message !== "string") return null;
  const text = message.trim();
  if (!text) return null;
  // Only the SHA-256 command accepts a multi-line payload (the text to hash).
  if (SHA256.test(text)) return "osa.crypto.sha256.v1";
  if (text.includes("\n") || text.includes("\r")) return null;
  if (REPOSITORY.test(text)) return "osa.worker.repo.inspect.v1";
  if (WORKER.test(text)) return "osa.worker.health.v1";
  if (RUNTIME.test(text)) return "osa.runtime.inspect.v1";
  return null;
}
