// src/lib/vitals.ts
// 🩺 Unified Vitals Model v1 – single source of truth for Alina's clinical state
// Focus: stress, energy, mood, focus – simple, composable, and serializable.

import type { ClinicalMood } from "@/lib/longTermMemory";

// Core dimensions we care about for this chapter
export type CoreVitalName = "stress" | "energy" | "mood" | "focus";

// Simple scalar with a trend (keeps math + UI flexible)
export type ScalarVital = {
  value: number; // 0..100 (soft convention)
  trend: "up" | "down" | "stable";
  lastUpdated: string; // ISO timestamp
};

// Mood is slightly special – we keep both a label + scalar feel
export type MoodVital = {
  label: ClinicalMood;
  intensity: number; // 0..100, how strong the mood signal is
  lastUpdated: string; // ISO timestamp
};

// 🔍 Unified snapshot Alina will read from
export type VitalsSnapshot = {
  userId: string;
  createdAt: string; // ISO timestamp – snapshot generation moment

  // Core dimensions
  stress: ScalarVital;
  energy: ScalarVital;
  focus: ScalarVital;
  mood: MoodVital;

  // Optional extras – future-proof without changing the core shape
  notes?: string;
  source?: "inferred" | "user_reported" | "system";
  meta?: Record<string, any>;
};

// Narrow update type Alina can work with per exchange
export type PartialVitalsUpdate = {
  stress?: number;
  energy?: number;
  focus?: number;
  moodLabel?: ClinicalMood;
  moodIntensity?: number;
  notesAppend?: string;
  source?: VitalsSnapshot["source"];
};

// 🍃 Default scalar vital – neutral, stable
function defaultScalarVital(now: string): ScalarVital {
  return {
    value: 50,
    trend: "stable",
    lastUpdated: now,
  };
}

// 🍃 Default mood – neutral, unknown intensity
function defaultMoodVital(now: string): MoodVital {
  return {
    label: "unknown",
    intensity: 0,
    lastUpdated: now,
  };
}

// 🧬 Create a brand new snapshot (e.g. for a new user or fallback)
export function createEmptyVitalsSnapshot(userId: string): VitalsSnapshot {
  const now = new Date().toISOString();

  return {
    userId,
    createdAt: now,
    stress: defaultScalarVital(now),
    energy: defaultScalarVital(now),
    focus: defaultScalarVital(now),
    mood: defaultMoodVital(now),
    source: "system",
    notes: undefined,
    meta: {},
  };
}

// 📈 Simple trend helper – compares old vs new scalar values
function computeTrend(oldValue: number, newValue: number): ScalarVital["trend"] {
  const delta = newValue - oldValue;
  const epsilon = 3; // dead zone to avoid jitter

  if (delta > epsilon) return "up";
  if (delta < -epsilon) return "down";
  return "stable";
}

// 🧩 Merge a partial update into an existing snapshot
export function mergeVitalsSnapshot(
  prev: VitalsSnapshot | null | undefined,
  userId: string,
  update: PartialVitalsUpdate
): VitalsSnapshot {
  const base = prev ?? createEmptyVitalsSnapshot(userId);
  const now = new Date().toISOString();

  const nextStressValue = update.stress ?? base.stress.value;
  const nextEnergyValue = update.energy ?? base.energy.value;
  const nextFocusValue = update.focus ?? base.focus.value;

  const stress: ScalarVital = {
    value: nextStressValue,
    trend: computeTrend(base.stress.value, nextStressValue),
    lastUpdated: update.stress !== undefined ? now : base.stress.lastUpdated,
  };

  const energy: ScalarVital = {
    value: nextEnergyValue,
    trend: computeTrend(base.energy.value, nextEnergyValue),
    lastUpdated: update.energy !== undefined ? now : base.energy.lastUpdated,
  };

  const focus: ScalarVital = {
    value: nextFocusValue,
    trend: computeTrend(base.focus.value, nextFocusValue),
    lastUpdated: update.focus !== undefined ? now : base.focus.lastUpdated,
  };

  const mood: MoodVital = {
    label: update.moodLabel ?? base.mood.label,
    intensity: update.moodIntensity ?? base.mood.intensity,
    lastUpdated:
      update.moodLabel !== undefined || update.moodIntensity !== undefined
        ? now
        : base.mood.lastUpdated,
  };

  let notes = base.notes;
  if (update.notesAppend) {
    notes = (notes ? notes + " " : "") + update.notesAppend;
  }

  return {
    userId: base.userId ?? userId,
    createdAt: base.createdAt ?? now,
    stress,
    energy,
    focus,
    mood,
    source: update.source ?? base.source,
    meta: base.meta ?? {},
    notes,
  };
}

// 🩻 Lightweight clinical inference – no heavy diagnostics,
// just a compact view Persona Engine can read.
export type ClinicalLevel = "low" | "moderate" | "high";

export type ClinicalInference = {
  stressLevel: ClinicalLevel;
  energyLevel: ClinicalLevel;
  focusLevel: ClinicalLevel;
  overallLoad: ClinicalLevel; // how "loaded" the system feels
};

// Map scalar 0..100 → bucket
function scalarToLevel(value: number): ClinicalLevel {
  if (value <= 33) return "low";
  if (value <= 66) return "moderate";
  return "high";
}

// 🎯 Single, simple inference function for Persona Engine
export function inferClinicalState(vitals: VitalsSnapshot): ClinicalInference {
  // Defensive: vitals may be partially populated. Fall back to 0 for missing scalars.
  const stressScalar =
    vitals && vitals.stress && typeof vitals.stress.value === "number"
      ? vitals.stress.value
      : 0;
  const energyScalar =
    vitals && vitals.energy && typeof vitals.energy.value === "number"
      ? vitals.energy.value
      : 0;
  const focusScalar =
    vitals && vitals.focus && typeof vitals.focus.value === "number"
      ? vitals.focus.value
      : 0;

  const stressLevel = scalarToLevel(stressScalar);
  const energyLevel = scalarToLevel(energyScalar);
  const focusLevel = scalarToLevel(focusScalar);

  // Heuristic: "overall load" is mostly stress vs energy
  // - High stress & low energy → high load
  // - Moderate combo → moderate load
  // - Else → low load
  let overallLoad: ClinicalLevel = "low";

  if (stressLevel === "high" && energyLevel === "low") {
    overallLoad = "high";
  } else if (
    stressLevel === "high" ||
    (stressLevel === "moderate" && energyLevel !== "high")
  ) {
    overallLoad = "moderate";
  }

  return {
    stressLevel,
    energyLevel,
    focusLevel,
    overallLoad,
  };
}
