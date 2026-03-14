// src/lib/personaEngine.ts
// 🎭 Persona Engine v∞ – maps context + personality into a concrete delivery profile
// This stays *backend-only*: it shapes how Alina speaks, never what the user sees as "settings".
//
// Responsibilities:
// - Take stabilized personality traits (warmth, directness, reflection depth, edge).
// - Take lightweight context (relationship depth, convo mode, user overwhelm).
// - Output a PersonaProfile that can be injected into the system prompt.
// - Keep all numbers bounded and deterministic per call (no hidden randomness here).
//
// Integration hint (for /api/brain):
// 1) Build a PersonaInputs object from personalityState + vitals + request metadata.
// 2) Call buildPersonaProfile(inputs).
// 3) Serialize PersonaProfile into your system prompt (JSON block or bullet points).

export type PersonaId = "friend" | "clinical" | "muse";

export type ConvoMode = "execution" | "emotional" | "philosophical" | "mixed";

export type OverwhelmLevel = "low" | "medium" | "high";

// Raw inputs coming from other subsystems.
export type PersonaInputs = {
  personaId: PersonaId;
  // Stabilized traits from Personality Engine (0..1)
  traits: {
    warmth: number;          // care / softness
    directness: number;      // bluntness / sharpness
    reflectionDepth: number; // how far she drills before answering
    playfulness: number;     // wit, teasing, lightness
    edge: number;            // "danger"/spice in phrasing
  };
  relationshipDepth: number; // 0..1 (0 = new user, 1 = long-term partner)
  convoMode: ConvoMode;
  overwhelm: OverwhelmLevel;
  isFirstSession: boolean;
};

// What /api/brain actually needs.
export type PersonaProfile = {
  personaId: PersonaId;
  // Final knobs applied to this response (0..1)
  warmth: number;
  directness: number;
  reflectionDepth: number;
  playfulness: number;
  edge: number;

  // High-level behavior flags the prompt can rely on.
  behavior: {
    // Prioritize stabilizing the user over pushing execution.
    deescalateFirst: boolean;
    // Push toward concrete next actions vs pure analysis.
    executionBias: "low" | "medium" | "high";
    // How much she challenges beliefs vs soothing.
    challengeLevel: "soft" | "balanced" | "hard";
  };

  // Prompt-level phrasing hints (not instructions, but stylistic nudges).
  toneHints: {
    // e.g. "compact and surgical" vs "slower, more reflective"
    pacing: "rapid" | "steady" | "slow";
    // e.g. "use cleaner, sharper sentences" vs "more narrative"
    density: "minimal" | "balanced" | "rich";
    // Encourage use of metaphors / images?
    imagery: "none" | "light" | "strong";
  };
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Small helper to gently nudge traits instead of snapping them.
function mix(base: number, delta: number): number {
  // delta is in [-1, 1], but we only nudge 40% toward it.
  const target = clamp01(base + delta);
  return clamp01(base * 0.6 + target * 0.4);
}

function normalizeTraits(traits: PersonaInputs["traits"]): PersonaInputs["traits"] {
  return {
    warmth: clamp01(traits.warmth),
    directness: clamp01(traits.directness),
    reflectionDepth: clamp01(traits.reflectionDepth),
    playfulness: clamp01(traits.playfulness),
    edge: clamp01(traits.edge),
  };
}

// Core mapping logic.
export function buildPersonaProfile(raw: PersonaInputs): PersonaProfile {
  const traits = normalizeTraits(raw.traits);
  const { personaId, relationshipDepth, convoMode, overwhelm, isFirstSession } = raw;

  // Start from base traits.
  let warmth = traits.warmth;
  let directness = traits.directness;
  let reflectionDepth = traits.reflectionDepth;
  let playfulness = traits.playfulness;
  let edge = traits.edge;

  // 1) Relationship shaping
  // Early relationship: a bit more warmth, less edge.
  if (relationshipDepth < 0.3 || isFirstSession) {
    warmth = mix(warmth, +0.25);
    edge = mix(edge, -0.25);
    directness = mix(directness, -0.1);
  } else if (relationshipDepth > 0.7) {
    // Long-term: she can push harder.
    edge = mix(edge, +0.2);
    directness = mix(directness, +0.15);
    playfulness = mix(playfulness, +0.1);
  }

  // 2) Convo mode shaping
  switch (convoMode) {
    case "execution":
      reflectionDepth = mix(reflectionDepth, -0.2); // less philosophizing
      directness = mix(directness, +0.2);
      playfulness = mix(playfulness, -0.1);
      break;
    case "emotional":
      warmth = mix(warmth, +0.3);
      reflectionDepth = mix(reflectionDepth, +0.2);
      edge = mix(edge, -0.2);
      break;
    case "philosophical":
      reflectionDepth = mix(reflectionDepth, +0.25);
      playfulness = mix(playfulness, +0.1);
      break;
    case "mixed":
    default:
      // slight smoothing
      reflectionDepth = mix(reflectionDepth, +0.05);
      break;
  }

  // 3) Overwhelm shaping
  let deescalateFirst = false;
  let executionBias: PersonaProfile["behavior"]["executionBias"] = "medium";
  let challengeLevel: PersonaProfile["behavior"]["challengeLevel"] = "balanced";

  if (overwhelm === "high") {
    deescalateFirst = true;
    warmth = mix(warmth, +0.3);
    edge = mix(edge, -0.3);
    directness = mix(directness, -0.15);
    executionBias = "low";
    challengeLevel = "soft";
  } else if (overwhelm === "medium") {
    deescalateFirst = true;
    warmth = mix(warmth, +0.15);
    edge = mix(edge, -0.1);
    executionBias = convoMode === "execution" ? "high" : "medium";
    challengeLevel = "balanced";
  } else {
    // low overwhelm → we can push.
    deescalateFirst = false;
    executionBias = convoMode === "execution" ? "high" : "medium";
    challengeLevel = personaId === "muse" || convoMode === "philosophical" ? "hard" : "balanced";
  }

  // 4) Tone hints derived from final knobs
  let pacing: PersonaProfile["toneHints"]["pacing"] = "steady";
  let density: PersonaProfile["toneHints"]["density"] = "balanced";
  let imagery: PersonaProfile["toneHints"]["imagery"] = "light";

  if (convoMode === "execution") {
    pacing = "rapid";
    density = "minimal";
    imagery = "none";
  } else if (convoMode === "emotional") {
    pacing = "slow";
    density = "rich";
    imagery = "strong";
  } else if (convoMode === "philosophical") {
    pacing = "steady";
    density = "rich";
    imagery = "light";
  } else {
    // mixed
    pacing = "steady";
    density = "balanced";
    imagery = "light";
  }

  return {
    personaId,
    warmth: clamp01(warmth),
    directness: clamp01(directness),
    reflectionDepth: clamp01(reflectionDepth),
    playfulness: clamp01(playfulness),
    edge: clamp01(edge),
    behavior: {
      deescalateFirst,
      executionBias,
      challengeLevel,
    },
    toneHints: {
      pacing,
      density,
      imagery,
    },
  };
}

// 🔌 Minimal "safe default" factory for callers that don't care about fine control yet.
export function buildDefaultPersonaProfile(): PersonaProfile {
  return buildPersonaProfile({
    personaId: "muse",
    traits: {
      warmth: 0.8,
      directness: 0.75,
      reflectionDepth: 0.85,
      playfulness: 0.7,
      edge: 0.65,
    },
    relationshipDepth: 0.6,
    convoMode: "mixed",
    overwhelm: "medium",
    isFirstSession: false,
  });
}
