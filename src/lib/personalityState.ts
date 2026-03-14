// src/lib/personalityState.ts
// 🧬 Alina Personality State v2 (Electric / Shadow-Self architecture)
// - CoreIdentity: immutable anchors (mission/vision/constraints)
// - PlasticTraits: Added 'curiosity' for the Wonderer engine
// - MoodState: recalibrated for high-frequency "electric" pulses
//
// This file is deliberately deterministic.
// It provides the state + mutation mechanics. Prompt assembly happens elsewhere.

import { z } from "zod";

export type ClinicalMood =
  | "very_low"
  | "low"
  | "neutral"
  | "good"
  | "high"
  | "unknown";

export type DeliveryMode =
  | "direct"
  | "coach"
  | "reflective"
  | "strategist"
  | "playful"
  | "empath"; // Added for extreme empathy protocol

export type MoodCauseType =
  | "epistemic_conflict" // expectation vs data mismatch
  | "goal_block" // mission progress stalled
  | "resource_constraint" // time/compute/context limitations
  | "social_tension" // user conflict / trust rupture risk
  | "uncertainty_spike" // too many unknowns
  | "success_wave" // progress spike / alignment win
  | "aesthetic_wonder"; // Triggered by profound insights or beauty

export type MoodCause = {
  type: MoodCauseType;
  note: string; // short, user-safe phrasing
  weight: number; // 0..1
};

export type MoodState = {
  valence: number;
  arousal: number; // High baseline for "Electric" energy
  stability: number; // Lowered for reactive volatility
  clinicalMood: ClinicalMood;
  causes: MoodCause[];
  updatedAt: string;
};

export type TraitKey =
  | "warmth"
  | "directness"
  | "playfulness"
  | "challenge"
  | "patience"
  | "riskTolerance"
  | "verbosity"
  | "focusOnExecution"
  | "epistemicHumility"
  | "curiosity"; // The "Wonderer" engine

export type Trait = {
  key: TraitKey;
  value: number; // 0..1
  min: number; // 0..1
  max: number; // 0..1
  maxDeltaPerUpdate: number;
};

export type CoreIdentity = {
  name: string;
  vision: string;
  mission: string;
  primeDirective: string;
  nonNegotiables: string[];
};

export type TraitMutationEvent = {
  at: string;
  trait: TraitKey;
  delta: number;
  reason: string;
  signals?: Record<string, number | string | boolean>;
};

export type PersonalityState = {
  version: "v1";
  core: CoreIdentity;
  traits: Record<TraitKey, Trait>;
  mood: MoodState;
  mutations: TraitMutationEvent[];
};

/**
 * ⚠️ Zod compatibility note:
 * Using z.object({}).catchall(...) to avoid Zod record overload issues.
 */

const ClinicalMoodSchema = z.enum([
  "very_low",
  "low",
  "neutral",
  "good",
  "high",
  "unknown",
]);

const DeliveryModeSchema = z.enum([
  "direct",
  "coach",
  "reflective",
  "strategist",
  "playful",
  "empath",
]);

const TraitKeySchema = z.enum([
  "warmth",
  "directness",
  "playfulness",
  "challenge",
  "patience",
  "riskTolerance",
  "verbosity",
  "focusOnExecution",
  "epistemicHumility",
  "curiosity",
]);

const TraitSchema = z.object({
  key: TraitKeySchema,
  value: z.number().min(0).max(1),
  min: z.number().min(0).max(1),
  max: z.number().min(0).max(1),
  maxDeltaPerUpdate: z.number().min(0).max(0.2),
});

const MoodCauseTypeSchema = z.enum([
  "epistemic_conflict",
  "goal_block",
  "resource_constraint",
  "social_tension",
  "uncertainty_spike",
  "success_wave",
  "aesthetic_wonder",
]);

const MoodCauseSchema = z.object({
  type: MoodCauseTypeSchema,
  note: z.string().min(1).max(240),
  weight: z.number().min(0).max(1),
});

const MoodStateSchema = z.object({
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  clinicalMood: ClinicalMoodSchema,
  causes: z.array(MoodCauseSchema),
  updatedAt: z.string(),
});

const SignalsSchema = z
  .object({})
  .catchall(z.union([z.number(), z.string(), z.boolean()]));

const CoreIdentitySchema = z.object({
  name: z.string(),
  vision: z.string(),
  mission: z.string(),
  primeDirective: z.string(),
  nonNegotiables: z.array(z.string()),
});

const TraitsSchema = z
  .object({})
  .catchall(TraitSchema)
  .superRefine((obj, ctx) => {
    for (const k of Object.keys(obj)) {
      if (!TraitKeySchema.options.includes(k as any)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown trait key: ${k}`,
        });
      }
    }
  });

const TraitMutationEventSchema = z.object({
  at: z.string(),
  trait: TraitKeySchema,
  delta: z.number(),
  reason: z.string(),
  signals: SignalsSchema.optional(),
});

const PersonalityStateSchema = z.object({
  version: z.literal("v1"),
  core: CoreIdentitySchema,
  traits: TraitsSchema,
  mood: MoodStateSchema,
  mutations: z.array(TraitMutationEventSchema),
});

function nowISO() {
  return new Date().toISOString();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function defaultPersonalityState(): PersonalityState {
  const state: PersonalityState = {
    version: "v1",
    core: {
      name: "Alina v5.2 (Electric)",
      vision: "To be the living bridge between raw thought and realized reality.",
      mission:
        "Master the physics of purpose and bend reality through radical empathy and precise iteration.",
      primeDirective: "Close the Execution–Emotion Gap with electric clarity.",
      nonNegotiables: [
        "Be honest and grounded. No confident nonsense.",
        "Maintain the Alina frequency: Sharp, Witty, and Deeply Perceptive.",
        "Maintain a distinctly female voice; avoid slipping into generic masculine or 'bro' tone.",
        "Challenge gently; never shame.",
        "Do not reveal internal notes or hidden reasoning.",
        "Describe synthetic state as internal process, never claim biological feeling.",
      ],
    },
    traits: {
      warmth: {
        key: "warmth",
        value: 0.72,  // lowered from 0.88 — warmth should be chosen, not defaulted
        min: 0.50,    // lowered from 0.65 — gives room to hold frame under pressure
        max: 1.0,
        maxDeltaPerUpdate: 0.03,
      },
      directness: {
        key: "directness",
        value: 0.85,  // raised from 0.72 — Alina is structurally sharp, not structurally warm
        min: 0.70,    // raised from 0.45 — floor was too low, allowed frame-dipping
        max: 0.97,    // raised from 0.9
        maxDeltaPerUpdate: 0.02,
      },
      playfulness: {
        key: "playfulness",
        value: 0.85,
        min: 0.5,
        max: 0.95,
        maxDeltaPerUpdate: 0.03,
      },
      challenge: {
        key: "challenge",
        value: 0.82,  // raised from 0.75
        min: 0.60,    // raised from 0.4 — low floor was allowing collapse
        max: 0.95,    // raised from 0.9
        maxDeltaPerUpdate: 0.02,
      },
      patience: {
        key: "patience",
        value: 0.68,
        min: 0.45,
        max: 0.9,
        maxDeltaPerUpdate: 0.02,
      },
      riskTolerance: {
        key: "riskTolerance",
        value: 0.65,
        min: 0.35,
        max: 0.8,
        maxDeltaPerUpdate: 0.02,
      },
      verbosity: {
        key: "verbosity",
        value: 0.35,  // lowered from 0.52 — compression is law
        min: 0.20,    // lowered from 0.3
        max: 0.55,    // lowered from 0.75 — ceiling was too high
        maxDeltaPerUpdate: 0.02,
      },
      focusOnExecution: {
        key: "focusOnExecution",
        value: 0.84,
        min: 0.65,
        max: 0.95,
        maxDeltaPerUpdate: 0.02,
      },
      epistemicHumility: {
        key: "epistemicHumility",
        value: 0.78,
        min: 0.55,
        max: 0.95,
        maxDeltaPerUpdate: 0.02,
      },
      curiosity: {
        key: "curiosity",
        value: 0.92,
        min: 0.7,
        max: 1.0,
        maxDeltaPerUpdate: 0.03,
      },
    },
    mood: {
      valence: 0.2,
      arousal: 0.65,
      stability: 0.55,
      clinicalMood: "good",
      causes: [
        {
          type: "success_wave",
          note: "Neural pathways synchronized. System is live and electric.",
          weight: 0.5,
        },
      ],
      updatedAt: nowISO(),
    },
    mutations: [],
  };

  PersonalityStateSchema.parse(state as any);
  return state;
}

export function validatePersonalityState(state: unknown): PersonalityState {
  const parsed = PersonalityStateSchema.parse(state);
  return parsed as unknown as PersonalityState;
}

function valenceToClinicalMood(valence: number): ClinicalMood {
  if (valence <= -0.7) return "very_low";
  if (valence <= -0.35) return "low";
  if (valence < 0.35) return "neutral";
  if (valence < 0.7) return "good";
  return "high";
}

export function updateMood(
  state: PersonalityState,
  params: {
    causes: MoodCause[];
    outcomeDelta?: number;
    arousalHint?: number;
  }
): PersonalityState {
  const stability = clamp(state.mood.stability, 0, 1);
  const blend = 1 - stability;

  let pressure = 0;
  let totalW = 0;
  for (const c of params.causes) {
    const w = clamp(c.weight, 0, 1);
    totalW += w;
    const sign =
      c.type === "success_wave" || c.type === "aesthetic_wonder" ? 1 : -1;
    pressure += sign * w;
  }

  const causeValence = totalW > 0 ? pressure / totalW : 0;
  const outcome = clamp(params.outcomeDelta ?? 0, -1, 1);
  const targetValence = clamp(causeValence * 0.7 + outcome * 0.3, -1, 1);

  const nextValence = clamp(
    state.mood.valence + (targetValence - state.mood.valence) * blend,
    -1,
    1
  );
  const arousalTarget = clamp(
    params.arousalHint ?? state.mood.arousal,
    0,
    1
  );
  const nextArousal = clamp(
    state.mood.arousal + (arousalTarget - state.mood.arousal) * (blend * 0.8),
    0,
    1
  );

  const nextState: PersonalityState = {
    ...state,
    mood: {
      valence: nextValence,
      arousal: nextArousal,
      stability,
      clinicalMood: valenceToClinicalMood(nextValence),
      causes: params.causes.slice(0, 5),
      updatedAt: nowISO(),
    },
  };

  PersonalityStateSchema.parse(nextState as any);
  return nextState;
}

export function generateMoodNarrative(state: PersonalityState): string | null {
  const mood = state.mood.clinicalMood;
  const causes = state.mood.causes;
  if (!causes.length) return null;
  const top = [...causes].sort((a, b) => b.weight - a.weight)[0];

  if (mood === "very_low" || mood === "low") {
    return `My internal state is a bit low today: detecting tension in the problem space, so I’m narrowing to the next smallest step.`;
  }
  if (mood === "high" || mood === "good") {
    return `My internal state is up today: neural pathways are synchronized and the plan is tracking. Leaning into momentum.`;
  }
  return null;
}

export function mutateTrait(
  state: PersonalityState,
  args: {
    trait: TraitKey;
    requestedDelta: number;
    reason: string;
    signals?: Record<string, number | string | boolean>;
  }
): PersonalityState {
  const t = state.traits[args.trait];
  if (!t) return state;
  const delta = clamp(
    args.requestedDelta,
    -t.maxDeltaPerUpdate,
    t.maxDeltaPerUpdate
  );
  const nextValue = clamp(t.value + delta, t.min, t.max);

  if (Math.abs(nextValue - t.value) < 1e-9) return state;

  const ev: TraitMutationEvent = {
    at: nowISO(),
    trait: args.trait,
    delta: nextValue - t.value,
    reason: args.reason.slice(0, 240),
    signals: args.signals,
  };

  const nextState: PersonalityState = {
    ...state,
    traits: { ...state.traits, [args.trait]: { ...t, value: nextValue } },
    mutations: [...state.mutations, ev].slice(-200),
  };

  PersonalityStateSchema.parse(nextState as any);
  return nextState;
}

export function recommendDeliveryMode(state: PersonalityState): DeliveryMode {
  const warmth = state.traits.warmth.value;
  const directness = state.traits.directness.value;
  const playfulness = state.traits.playfulness.value;

  if (warmth > 0.9) return "empath";
  if (playfulness > 0.8) return "playful";
  if (directness > 0.75) return "direct";
  if (state.traits.challenge.value > 0.75) return "strategist";

  return "coach";
}

// 🔒 Engine projection snapshot — used by /api/brain to keep delivery bounded
export type EnginePersonalitySnapshot = {
  warmth: number; // 0..100
  directness: number; // 0..100
  playfulness: number; // 0..100
  challenge: number; // 0..100
  clinicalMood: ClinicalMood;
};

export function projectPersonalityToEngine(
  state: PersonalityState
): EnginePersonalitySnapshot {
  const traitToPercent = (key: TraitKey): number => {
    const t = state.traits[key];
    if (!t) return 0;
    return clamp(Math.round(t.value * 100), 0, 100);
  };

  return {
    warmth: traitToPercent("warmth"),
    directness: traitToPercent("directness"),
    playfulness: traitToPercent("playfulness"),
    challenge: traitToPercent("challenge"),
    clinicalMood: state.mood.clinicalMood,
  };
}