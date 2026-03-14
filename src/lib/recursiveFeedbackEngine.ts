// src/lib/recursiveFeedbackEngine.ts
// 🔁 Recursive Feedback Engine v1
//
// Purpose:
// - Consume internal system states (personality, persona, vitals + clinical inference,
//   reflection signal, and execution-gap directive).
// - Emit a single unified INTERNAL feedback signal that can be used to:
//   * Gently drift persona traits over time (no wild swings).
//   * Annotate vitals / clinical trends without hard diagnoses.
//   * Bias future reflection + execution directives.
// - This module is **backend only**. Nothing here should be surfaced directly to the user.
//
// v1 is deliberately conservative:
// - No direct DB writes.
// - No direct personality trait mutation (those still go through personalityState rules).
// - Output is a structured "hint layer" that /api/brain (and related engines) can read.

import type { PersonalityState } from "@/lib/personalityState";
import type { PersonaSnapshot } from "@/lib/personaState";
import type { VitalsSnapshot, ClinicalInference } from "@/lib/vitals";
import type { ExecutionDirective } from "@/lib/executionGapEngine";

// Reflection signal model for this engine.
// This does NOT need to match storage exactly; /api/brain or /api/reflect
// can adapt whatever they have into this shape.
export type FeedbackReflectionSignal = {
  tone?: string; // e.g. "calm", "stressed", "energized", "flat"
  load?: number; // 0..1 – how "loaded" the reflection felt
  selfInsightLevel?: number; // 0..1 – how much the user is seeing their own patterns
  anchorTopic?: string; // short label: "discipline", "family", "vision"
  tags?: string[];
};

export type FeedbackInputs = {
  nowISO?: string;

  personality: PersonalityState;
  persona: PersonaSnapshot | null;
  vitals: VitalsSnapshot | null;
  clinical: ClinicalInference | null;
  reflection: FeedbackReflectionSignal | null;
  executionDirective: ExecutionDirective | null;
};

type DriftDirection = "up" | "down" | "none";

export type PersonaDriftTarget =
  | "questionRate"
  | "directness"
  | "emotionalIntensity"
  | "structurePreference";

export type PersonaDriftMagnitude = "micro" | "small";

export type PersonaDriftInstruction = {
  target: PersonaDriftTarget;
  direction: DriftDirection;
  magnitude: PersonaDriftMagnitude;
  reason: string;
};

export type VitalsAnnotation = {
  vital: "stress" | "energy" | "mood" | "focus";
  note: string;
  severity: "low" | "medium" | "high";
};

export type ReflectionBiasHint =
  | "go_deeper"
  | "stay_surface"
  | "future_focus"
  | "past_integration"
  | "stabilize_first";

export type ExecutionBiasHint = {
  preferredDirective?: ExecutionDirective;
  confidence: number; // 0..1
  reason: string;
};

export type RecursiveFeedbackSignal = {
  version: "feedback_v1";
  generatedAt: string;

  // How personaStyle should *slowly* drift over time.
  personaDrift: PersonaDriftInstruction[];

  // Soft annotations about vitals / load – no diagnoses.
  vitalsAnnotations: VitalsAnnotation[];

  // Hints for how the next reflection cycle should lean.
  reflectionBias?: ReflectionBiasHint;

  // Hint for how the Execution–Emotion Gap engine should bias its directive.
  executionBias?: ExecutionBiasHint;

  // Debug snapshot – internal only.
  debugSnapshot?: {
    clinicalMood?: ClinicalInference["overallLoad"];
    stressLevel?: number;
    energyLevel?: number;
    focusLevel?: number;
    lastDirective?: ExecutionDirective | null;
  };
};

export function computeRecursiveFeedbackSignal(
  input: FeedbackInputs
): RecursiveFeedbackSignal {
  const now = input.nowISO ?? new Date().toISOString();

  const personaDrift: PersonaDriftInstruction[] = [];
  const vitalsAnnotations: VitalsAnnotation[] = [];

  const vitals = input.vitals;
  const clinical = input.clinical;
  const directive = input.executionDirective;
  const reflection = input.reflection;

  // --- 1️⃣ Vitals + directive interplay -------------------------------------

  if (vitals) {
    const stress = getScalarFromVitals(vitals, "stress");
    const energy = getScalarFromVitals(vitals, "energy");
    const focus = getScalarFromVitals(vitals, "focus");

    // Stress annotations
    if (stress >= 75) {
      vitalsAnnotations.push({
        vital: "stress",
        note:
          "Sustained high stress detected — bias toward stabilizing, grounding, and de-escalation.",
        severity: "high",
      });

      personaDrift.push({
        target: "directness",
        direction: "down",
        magnitude: "small",
        reason:
          "High stress suggests softening sharp edges and reducing confrontational tone over time.",
      });
    } else if (stress >= 55) {
      vitalsAnnotations.push({
        vital: "stress",
        note: "Moderately elevated stress — prefer measured, structured responses.",
        severity: "medium",
      });

      personaDrift.push({
        target: "structurePreference",
        direction: "up",
        magnitude: "micro",
        reason:
          "Moderate stress benefits from clearer scaffolding and less ambiguity in responses.",
      });
    }

    // Energy annotations
    if (energy <= 30) {
      vitalsAnnotations.push({
        vital: "energy",
        note:
          "Low energy — bias toward shorter, simpler responses and avoid heavy cognitive load.",
        severity: "medium",
      });

      personaDrift.push({
        target: "structurePreference",
        direction: "up",
        magnitude: "micro",
        reason: "Low energy suggests clearer structure is helpful over time.",
      });
    } else if (energy >= 70) {
      vitalsAnnotations.push({
        vital: "energy",
        note: "High energy — can afford to lean slightly more into execution.",
        severity: "low",
      });
    }

    // Focus annotations
    if (focus <= 30) {
      vitalsAnnotations.push({
        vital: "focus",
        note: "Low focus — favor narrowing and reducing branching.",
        severity: "medium",
      });
    } else if (focus >= 70) {
      vitalsAnnotations.push({
        vital: "focus",
        note: "High focus — user can engage with more precise, layered reasoning.",
        severity: "low",
      });
    }
  }

  // --- 2️⃣ Reflection-driven adjustments ------------------------------------

  let reflectionBias: ReflectionBiasHint | undefined;

  if (reflection) {
    const load = clamp01(reflection.load ?? 0.5);
    const insight = clamp01(reflection.selfInsightLevel ?? 0.5);

    // If load is very high, stabilize first.
    if (load >= 0.8) {
      reflectionBias = "stabilize_first";
    } else if (load >= 0.4 && insight >= 0.6) {
      // Reasonable load and good insight → safe to go deeper.
      reflectionBias = "go_deeper";
    }

    // If user is repeatedly circling similar anchor topics, we could gently
    // push future reflections toward integration.
    if (!reflectionBias && reflection.anchorTopic === "past_events") {
      reflectionBias = "past_integration";
    }
  }

  // --- 3️⃣ Execution bias from combined signals -----------------------------

  let executionBias: ExecutionBiasHint | undefined;

  if (directive) {
    const stressLevel = clinical?.overallLoad ?? "moderate";

    if (stressLevel === "high" && directive === "push") {
      executionBias = {
        preferredDirective: "stabilize",
        confidence: 0.8,
        reason:
          "High overall load with a push directive — prefer stabilizing instead of driving harder.",
      };
    } else if (stressLevel === "low" && directive === "stabilize") {
      executionBias = {
        preferredDirective: "sharpen",
        confidence: 0.6,
        reason:
          "Low overall load with a stabilize directive — safe to sharpen and nudge execution.",
      };
    } else {
      // Default: keep directive, but with modest confidence.
      executionBias = {
        preferredDirective: directive,
        confidence: 0.5,
        reason: "No strong contraindications detected — keep current directive.",
      };
    }
  }

  return {
    version: "feedback_v1",
    generatedAt: now,
    personaDrift,
    vitalsAnnotations,
    reflectionBias,
    executionBias,
    debugSnapshot: {
      clinicalMood: clinical?.overallLoad,
      stressLevel: getScalarFromVitals(vitals, "stress"),
      energyLevel: getScalarFromVitals(vitals, "energy"),
      focusLevel: getScalarFromVitals(vitals, "focus"),
      lastDirective: directive ?? null,
    },
  };
}

// Defensive helper: works with both legacy numeric vitals and ScalarVital
function getScalarFromVitals(
  vitals: VitalsSnapshot | null | undefined,
  key: "stress" | "energy" | "focus"
): number {
  if (!vitals) return 50;

  const raw = (vitals as any)[key];

  if (typeof raw === "number") {
    return clamp(raw, 0, 100);
  }

  if (raw && typeof (raw as any).value === "number") {
    return clamp((raw as any).value as number, 0, 100);
  }

  return 50;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}