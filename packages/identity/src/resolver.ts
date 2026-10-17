import type { AiProfileV01 } from "../../contracts/src/trust";
import { aiProfileUrl, canonicalizeAiId, parseAiId } from "./ai-id";

export interface AiProfileFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type AiProfileFetcher = (url: string) => Promise<AiProfileFetchResponse>;

function asProfile(value: unknown): AiProfileV01 {
  if (!value || typeof value !== "object") throw new Error("AI_PROFILE_INVALID: profile must be an object");
  const profile = value as Partial<AiProfileV01>;
  if (profile.spec !== "ai-profile/0.1") throw new Error("AI_PROFILE_INVALID: unsupported spec");
  if (typeof profile.id !== "string") throw new Error("AI_PROFILE_INVALID: id is required");
  if (typeof profile.name !== "string" || !profile.name) throw new Error("AI_PROFILE_INVALID: name is required");
  if (typeof profile.canonical !== "string" || !profile.canonical) throw new Error("AI_PROFILE_INVALID: canonical is required");
  if (!Array.isArray(profile.links)) throw new Error("AI_PROFILE_INVALID: links are required");
  return profile as AiProfileV01;
}

async function fetchProfile(url: string, fetcher: AiProfileFetcher): Promise<AiProfileV01> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`AI_PROFILE_FETCH_FAILED: HTTP ${response.status}`);
  return asProfile(await response.json());
}

export async function resolveAiId(
  input: string,
  fetcher: AiProfileFetcher
): Promise<AiProfileV01> {
  const requested = parseAiId(input);
  const rootId = `@ai:${requested.authority}`;
  const root = await fetchProfile(aiProfileUrl(rootId), fetcher);

  if (canonicalizeAiId(root.id) !== rootId) {
    throw new Error("AI_PROFILE_IDENTITY_MISMATCH: root id does not match authority");
  }

  if (requested.profile_path.length === 0) return root;

  const requestedId = requested.canonical;
  const ref = root.profiles?.find((candidate) => {
    try {
      return canonicalizeAiId(candidate.id) === requestedId;
    } catch {
      return false;
    }
  });
  if (!ref) throw new Error("AI_SUBPROFILE_NOT_FOUND");

  let target: URL;
  try {
    target = new URL(ref.href);
  } catch {
    throw new Error("AI_PROFILE_SECURITY_BLOCKED: subprofile href is not a valid URL");
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.port ||
    target.hostname.toLowerCase() !== requested.authority
  ) {
    throw new Error("AI_PROFILE_SECURITY_BLOCKED: subprofile href must use HTTPS on the root authority");
  }

  const profile = await fetchProfile(target.toString(), fetcher);
  if (canonicalizeAiId(profile.id) !== requestedId) {
    throw new Error("AI_PROFILE_IDENTITY_MISMATCH: subprofile id does not match request");
  }
  return profile;
}
