// src/lib/executionGapEngine.ts
// ⚙️ Execution–Emotion Gap Engine v1
//
// Purpose:
// - Take in vitals, recent reflection signal, short-term pattern, and emotional intensity
// - Output a single INTERNAL directive describing how hard / how narrow Alina should lean
//   into execution: "push", "stabilize", "narrow", "widen", "sharpen", "slow"
// - This directive is NEVER surfaced directly to the user – it’s for prompt shaping only.

import type { VitalsSnapshot, ClinicalInference } from "@/lib/vitals";
import { inferClinicalState } from "@/lib/vitals";
import type { ChatMessage } from "@/lib/memory";

// ℹ️ v1 Reflection signal model for this engine.
// This does NOT need to match storage exactly; /api/brain will adapt whatever it has
// into this shape when calling the engine.
export type ExecutionReflectionTone =
  | "stability"
  | "overwhelm"
  | "conflict"
  | "clarity"
  | "momentum"
  | "none"
  | "unknown";

export interface ExecutionReflectionSignal {
  hasRecentReflection: boolean;
  tone: ExecutionReflectionTone;
  // Rough sense of how emotionally loaded the last reflection felt.
  // 0..1 (soft convention); null if unknown.
  emotionalLoad?: number | null;
  // How recently the last reflection was written, in minutes. Null if unknown.
  recencyMinutes?: number | null;
}

// Short-term pattern v1 – built from recent chat window.
// We keep this minimal and derive stats here so we don’t force refactors elsewhere.
export interface ShortTermPattern {
  // Recent conversational window; typically built from buildShortTermMemory(...)
  window: ChatMessage[];
}

// The only thing the rest of the system should care about.
export type ExecutionDirective =
  | "push"
  | "stabilize"
  | "narrow"
  | "widen"
  | "sharpen"
  | "slow";

export interface ExecutionGapInputs {
  vitals: VitalsSnapshot;
  // Optional reflection signal; brain route can pass null if nothing is available.
  reflectionSignal: ExecutionReflectionSignal | null;
  // Optional short-term window; brain route can pass null if unavailable.
  shortTermPattern: ShortTermPattern | null;
  // Overall emotional intensity of the CURRENT exchange, 0..1 (soft convention).
  // Caller is free to derive this from sentiment, caps, exclamation density, etc.
  emotionalIntensity: number | null;
}

// Main entrypoint – pure function, no side effects.
export function computeExecutionDirective(
  inputs: ExecutionGapInputs,
): ExecutionDirective {
  const { vitals } = inputs;

  const clinical: ClinicalInference = inferClinicalState(vitals);
  const reflection = inputs.reflectionSignal ?? null;
  const shortTerm = inputs.shortTermPattern ?? null;
  const emo = normalize0to1(inputs.emotionalIntensity);

  const shortStats = deriveShortTermStats(shortTerm);

  // 1️⃣ Hard safety rails: overloaded system → de-risk, slow down.
  if (clinical.overallLoad === "high") {
    // High stress + low energy → slow everything down.
    if (clinical.stressLevel === "high" && clinical.energyLevel === "low") {
      return "slow";
    }

    // High stress but some energy left → stabilize before pushing.
    return "stabilize";
  }

  // 2️⃣ Emotional spikes: very high emotional intensity → stabilization bias.
  if (emo >= 0.85) {
    if (shortStats.consecutiveUserTurns >= 3) {
      // User is dumping a lot in a row at high intensity → widen gently.
      return "widen";
    }
    return "stabilize";
  }

  // 3️⃣ Cognitive drift: focus low but energy available → narrow the aperture.
  if (clinical.focusLevel === "low" && clinical.energyLevel !== "low") {
    return "narrow";
  }

  // 4️⃣ Rumination / looping: user talking a lot in a row with moderate intensity.
  if (
    shortStats.consecutiveUserTurns >= 4 &&
    emo >= 0.4 &&
    emo <= 0.8 &&
    shortStats.lastUserLength >= 280
  ) {
    // User is likely circling around an issue.
    return "widen";
  }

  // 5️⃣ Reflection-driven adjustments.
  const tone = reflection?.tone ?? "unknown";
  const reflLoad = normalize0to1(reflection?.emotionalLoad ?? null);

  if (reflection?.hasRecentReflection) {
    if (tone === "overwhelm" && reflLoad >= 0.6) {
      return "stabilize";
    }

    if (tone === "clarity" || tone === "momentum") {
      // System recently reached clarity – good moment to sharpen / push.
      if (clinical.focusLevel === "high") {
        return "sharpen";
      }
      return "push";
    }

    if (tone === "conflict" && reflLoad >= 0.5) {
      // Conflict + noticeable load → go narrow, don’t over-widen.
      return "narrow";
    }
  }

  // 6️⃣ Low-load & decent focus → bias toward pushing.
  if (clinical.overallLoad === "low") {
    if (clinical.focusLevel === "high") {
      // Good headroom and focus – best time to sharpen.
      return "sharpen";
    }

    // Low load but imperfect focus – nudge to push forward.
    return "push";
  }

  // 7️⃣ Moderate load default: stay steady unless emotions are clearly low.
  if (clinical.overallLoad === "moderate") {
    if (emo <= 0.25 && clinical.focusLevel !== "low") {
      // Emotionally flat but not overloaded – a gentle push is safe.
      return "push";
    }

    // Otherwise, stabilize by default.
    return "stabilize";
  }

  // 8️⃣ Absolute fallback – if something is weird, stay safe & steady.
  return "stabilize";
}

// --- helpers ---

function normalize0to1(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

interface ShortTermStats {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  consecutiveUserTurns: number;
  lastUserLength: number;
}

function deriveShortTermStats(
  pattern: ShortTermPattern | null,
): ShortTermStats {
  const window = pattern?.window ?? [];
  let userMessages = 0;
  let assistantMessages = 0;
  let consecutiveUserTurns = 0;
  let lastUserLength = 0;

  for (const msg of window) {
    if (!msg || typeof msg.content !== "string") continue;
    if (msg.role === "user") {
      userMessages += 1;
      lastUserLength = msg.content.length;
    } else if (msg.role === "assistant") {
      assistantMessages += 1;
    }
  }

  // Count consecutive user turns from the end.
  for (let i = window.length - 1; i >= 0; i--) {
    const msg = window[i];
    if (!msg) break;
    if (msg.role === "user") {
      consecutiveUserTurns += 1;
    } else {
      break;
    }
  }

  return {
    totalMessages: window.length,
    userMessages,
    assistantMessages,
    consecutiveUserTurns,
    lastUserLength,
  };
}