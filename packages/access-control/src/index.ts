import type {
  Identity,
  LayerEnterResult,
  LayerProfile,
  OsaLayerId,
} from "../../contracts/src";

const REGULATED_REQUIREMENTS = [
  "organization_verification",
  "affiliation_verification",
  "policy_acceptance",
  "administrative_approval",
] as const;

const PROFILES: readonly LayerProfile[] = [
  {
    layer_id: "school",
    label: "SCHOOL",
    product_layer: "ACADEMY",
    access_mode: "PUBLIC",
    route: "/school/",
    proof_required: true,
    requirements: [],
  },
  {
    layer_id: "dev",
    label: "DEV",
    product_layer: "BUILDER",
    access_mode: "AUTHENTICATED",
    route: "/dev/",
    proof_required: true,
    requirements: ["authenticated_session"],
  },
  {
    layer_id: "bank",
    label: "BANK",
    product_layer: "REGULATED",
    access_mode: "REGULATED",
    route: "/bank/",
    proof_required: true,
    requirements: [...REGULATED_REQUIREMENTS],
  },
  {
    layer_id: "financial",
    label: "FINANCIAL",
    product_layer: "REGULATED",
    access_mode: "REGULATED",
    route: "/financial/",
    proof_required: true,
    requirements: [...REGULATED_REQUIREMENTS],
  },
  {
    layer_id: "cybersecurity",
    label: "CYBERSECURITY",
    product_layer: "REGULATED",
    access_mode: "REGULATED",
    route: "/cybersecurity/",
    proof_required: true,
    requirements: [...REGULATED_REQUIREMENTS],
  },
  {
    layer_id: "army",
    label: "ARMY",
    product_layer: "REGULATED",
    access_mode: "REGULATED",
    route: "/army/",
    proof_required: true,
    requirements: [...REGULATED_REQUIREMENTS],
  },
];

const PROFILE_BY_ID = new Map<OsaLayerId, LayerProfile>(
  PROFILES.map((profile) => [profile.layer_id, profile])
);

function cloneProfile(profile: LayerProfile): LayerProfile {
  return structuredClone(profile);
}

export function listLayerProfiles(): LayerProfile[] {
  return PROFILES.map(cloneProfile);
}

export function getLayerProfile(layerId: string): LayerProfile | undefined {
  const profile = PROFILE_BY_ID.get(layerId as OsaLayerId);
  return profile ? cloneProfile(profile) : undefined;
}

export function enterLayer(layerId: string, identity?: Identity): LayerEnterResult | undefined {
  const profile = getLayerProfile(layerId);
  if (!profile) return undefined;

  if (profile.access_mode === "PUBLIC") {
    return {
      decision: "ALLOWED",
      layer: profile,
    };
  }

  if (profile.access_mode === "AUTHENTICATED") {
    if (identity?.verified) {
      return {
        decision: "ALLOWED",
        layer: profile,
      };
    }

    return {
      decision: "GATED",
      layer: profile,
      gate: {
        code: "AUTHENTICATED_SESSION_REQUIRED",
        requirements: ["authenticated_session"],
        authoritative: true,
      },
    };
  }

  return {
    decision: "GATED",
    layer: profile,
    gate: {
      code: "VERIFIED_ORGANIZATION_REQUIRED",
      requirements: [...REGULATED_REQUIREMENTS],
      authoritative: true,
    },
  };
}
