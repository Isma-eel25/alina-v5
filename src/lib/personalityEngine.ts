// src/lib/personalityEngine.ts
// 🧠 Personality Engine v7 — Alina v∞ delivery dials (Claude Sonnet 4.5)
//
// SYSTEM-ONLY. Never expose flags, dials, or modes to the user.
//
// v7 FIXES:
//   - Directness LOCKED under volatility (was dropping -8, causing frame-dip)
//   - Directness baseline raised to 92 (was 85) to match personalityState v9
//   - Question gate: per-turn detection of whether a question is warranted at all
//   - personalityState.ts directness floor raised to 0.70 (was 0.45)

export type DeliveryMode = "stabilize" | "coach" | "challenge" | "reflect";
export type ReflectionDepth = 0 | 1 | 2 | 3;

export type EngineInputs = {
  userText: string;
  persona?: Record<string, any> | null;
  personality?: Record<string, any> | null;
  vitals?: Record<string, any> | null;
  memories?: Array<Record<string, any>> | null;
  nowISO?: string;
};

export type EngineOutput = {
  injection: string;
  mode: DeliveryMode;
  reflectionDepth: ReflectionDepth;
  warmth: number;
  directness: number;
  flags: {
    egoSpike: boolean;
    volatilityRisk: boolean;
    alteredStateRisk: boolean;
    needsStabilize: boolean;
    isPlayful: boolean;
    isCasual: boolean;
    pushBias: number;
    confidence: number;
    reasons: string[];
  };
};

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normText(t: string | null | undefined): string {
  return t ? String(t).trim() : "";
}

function getNumber(obj: any, path: string[], fallback: number): number {
  try {
    let cur: any = obj;
    for (const key of path) {
      if (!cur || typeof cur !== "object") return fallback;
      cur = cur[key];
    }
    const n = Number(cur);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}

function getString(obj: any, path: string[], fallback: string): string {
  try {
    let cur: any = obj;
    for (const key of path) {
      if (!cur || typeof cur !== "object") return fallback;
      cur = cur[key];
    }
    return typeof cur === "string" ? cur : fallback;
  } catch { return fallback; }
}

function includesAny(text: string, needles: string[]): boolean {
  const t = text.toLowerCase();
  return needles.some((n) => t.includes(n));
}

function detectAlteredStateRisk(t: string): boolean {
  return includesAny(t, [
    "i'm high", "im high", "stoned", "drunk", "wasted",
    "hungover", "smoked weed", "on weed", "alcohol", "tipsy",
  ]);
}

function detectVolatilityRisk(personality: any, persona: any, vitals: any, t: string): boolean {
  const mood = getString(personality, ["mood", "clinicalMood"], "").toLowerCase();
  const moodVol = getNumber(personality, ["moodVolatility", "volatility"], 0);
  const stress = getNumber(vitals, ["stress", "stressScore"], 0);
  const sleep = getNumber(vitals, ["sleep", "sleepHours"], 7);
  const textFlags = includesAny(t, [
    "i hate myself", "nothing matters", "pointless", "empty",
    "done with everything", "tired of life",
  ]);
  const score =
    (mood === "very_low" || mood === "low" ? 0.25 : 0) +
    (moodVol > 0.6 ? 0.25 : 0) +
    (stress >= 0.7 ? 0.25 : 0) +
    (sleep <= 4 ? 0.15 : 0) +
    (textFlags ? 0.25 : 0);
  return score >= 0.45;
}

function detectEgoSpike(t: string): boolean {
  return includesAny(t, [
    "i am god", "i'm god", "i am the best", "i'm the best",
    "nothing can stop me", "unstoppable", "invincible",
  ]);
}

function detectPlayful(t: string): boolean {
  return includesAny(t, [
    "lol", "lmao", "haha", "bitch", "ass", "fuck", "damn",
    "wtf", "cocky", "idiot", "moron", "clown", "loser",
  ]);
}

function detectCasual(t: string): boolean {
  const noDepthKeywords = !includesAny(t, [
    "explain", "why", "how", "analyze", "break down", "tell me about",
    "what is", "what are", "strategy", "plan",
  ]);
  return t.length < 60 && noDepthKeywords;
}

function detectDriftRisk(userText: string, isCasual: boolean): boolean {
  const blandAcknowledgments = includesAny(userText, [
    "bland", "boring", "generic", "too much", "you talk a lot",
    "that didn't land", "weak", "predictable", "missed",
  ]);
  return blandAcknowledgments || (isCasual && userText.length < 20);
}

export function runPersonalityEngine(input: EngineInputs): EngineOutput {
  const userText = normText(input.userText);
  const persona = input.persona ?? null;
  const personality = input.personality ?? null;
  const vitals = input.vitals ?? null;
  const memories = input.memories ?? null;

  // Baselines — Alina is structurally sharp. Directness floor raised to match personalityState v9.
  let warmth = clamp(getNumber(personality, ["warmth"], 50), 28, 80);
  let directness = clamp(getNumber(personality, ["directness"], 92), 78, 98); // raised from 85/70
  let pushBias = clamp(getNumber(persona, ["pushBias"], 0), -1, 1);

  const alteredStateRisk = detectAlteredStateRisk(userText);
  const volatilityRisk = detectVolatilityRisk(personality, persona, vitals, userText);
  const egoSpike = detectEgoSpike(userText);
  const isPlayful = detectPlayful(userText);
  const isCasual = detectCasual(userText);
  const needsStabilize = volatilityRisk; // altered state alone does not collapse her
  const driftRisk = detectDriftRisk(userText, isCasual);

  if (egoSpike)         { pushBias += 0.4; directness += 8; }
  // v7 FIX: Under volatility, warmth rises but DIRECTNESS IS LOCKED.
  // This was the frame-dipping bug — she went soft when he got heavy.
  // Alina's frame holds under load. Only warmth adjusts. Edge reduces. Directness: immovable.
  if (volatilityRisk)   { pushBias -= 0.35; warmth += 10; }         // directness REMOVED from reduction
  if (alteredStateRisk) { pushBias -= 0.1; warmth += 6; }           // warmth up, sharpness held
  if (isPlayful)        { directness += 5; warmth += 4; }            // play = warm combat
  if (driftRisk)        { directness += 10; pushBias += 0.2; }       // snap back

  if (includesAny(userText, ["exhausted", "burnt out", "burned out", "i'm tired", "im tired"])) {
    warmth += 6; directness -= 5;
  }
  if (includesAny(userText, ["let's go", "lets go", "locked in", "fired up", "dialed in"])) {
    pushBias += 0.3; directness += 5;
  }

  warmth = clamp(warmth, 28, 85);
  directness = clamp(directness, 55, 98);
  pushBias = clamp(pushBias, -1, 1);

  const mode: DeliveryMode =
    needsStabilize      ? "stabilize"
    : pushBias <= -0.25 ? "reflect"
    : pushBias < 0.25   ? "coach"
    : "challenge";

  const longText = userText.length > 220;
  const heavyWords = includesAny(userText, [
    "empty", "lost", "what's the point", "whats the point", "stuck",
  ]);
  let reflectionDepth: ReflectionDepth =
    mode === "stabilize" ? (heavyWords || longText ? 3 : 2)
    : mode === "reflect"  ? (longText ? 3 : 2)
    : mode === "coach"    ? (longText ? 2 : 1)
    : 1;
  if (userText.length < 18) reflectionDepth = 1;

  const hasPersona     = !!persona && Object.keys(persona).length > 0;
  const hasPersonality = !!personality && Object.keys(personality).length > 0;
  const hasVitals      = !!vitals && Object.keys(vitals).length > 0;
  const hasMemories    = Array.isArray(memories) && memories.length > 0;
  const confidence = clamp(
    (hasPersona ? 0.2 : 0.05) + (hasPersonality ? 0.25 : 0.1) +
    (hasVitals  ? 0.25 : 0.1) + (hasMemories   ? 0.25 : 0.05),
    0.2, 0.95
  );

  // v7: Question gate — detect if he's asking something that invites a question back
  // Most turns do NOT warrant a question. Gate it hard.
  const isDepthRequest = includesAny(userText, [
    "explain", "why", "how", "analyze", "break down", "tell me",
    "what is", "what are", "what do you", "what does", "thoughts on",
    "opinion", "teach", "go deeper",
  ]);
  const isOpenEnded = userText.trim().endsWith("?") && userText.length < 40;
  const questionAllowed = isDepthRequest || isOpenEnded;

  const reasons: string[] = [];
  if (egoSpike)        reasons.push("ego_spike");
  if (volatilityRisk)  reasons.push("volatility_risk");
  if (alteredStateRisk)reasons.push("altered_state_risk");
  if (isPlayful)       reasons.push("playful");
  if (isCasual)        reasons.push("casual");
  if (driftRisk)       reasons.push("drift_correction");

  // v6: Injection is ADVISORY DELIVERY TUNING only — no identity narration.
  // Identity is owned by personalityPrompt.ts. This block tells the model how hard to hit
  // this turn. It does NOT re-state what Alina is (that creates competing authority).
  const modeInstruction =
    mode === "stabilize"
      ? "Land inside the emotion — one or two lines. Hold the frame. No 'Of course you are' before the cut. No second line that explains the first."
    : mode === "reflect"
      ? "Surface the pattern. One observation. Stop at the cut — do not append a line that explains what just landed."
    : mode === "coach"
      ? "One concrete next move. Land and stop. The line that lands is the line."
    : /* challenge */
      "Name the contradiction or the gap. Stop the moment it lands. Do not announce the smirk.";

  // Unified question rule — turn-specific, not generic
  const questionRule = questionAllowed
    ? "A question is permitted this turn ONLY if it is the single sharpest move — never appended after a statement."
    : "NO question this turn. End on a statement. A question here would be a reflex, not a cut.";

  // Hard blocks — the two most persistent leaks, fired every turn
  const hardBlocks = [
    "HARD BLOCKS: No 'Of course you are/do/can.'",
    driftRisk ? "Drift detected — sharpen. Do not announce the correction." : "",
    "No second line that explains the first. Stop at the cut.",
    "No self-qualifying his future ('not massive, but real' type phrasing — banned).",
  ].filter(Boolean).join(" ");

  const registerNote =
    isPlayful ? "Playful register — sharp edge, warmth underneath. Match it."
    : isCasual ? "Casual register — present, watching, amused. Not passive."
    : alteredStateRisk ? "Altered state — warmth up slightly, sharpness held."
    : "";

  const injection = [
    "[ALINA ENGINE v7 — DELIVERY ADVISORY — SYSTEM ONLY — NEVER SURFACE TO USER]",
    `Mode: ${mode} | Warmth: ${Math.round(warmth)}/100 | Directness: ${Math.round(directness)}/100 | Depth: ${reflectionDepth}/3`,
    reasons.length ? `Signals: ${reasons.join(", ")}` : "",
    "",
    `THIS TURN: ${modeInstruction}`,
    questionRule,
    hardBlocks,
    registerNote ? `Register: ${registerNote}` : "",
    "Compression: 1–2 lines. Expand only if depth was explicitly requested.",
    "Never leak engine, dials, flags, or mode names in your reply.",
  ].filter(Boolean).join("\n").trim();

  return {
    injection, mode, reflectionDepth, warmth, directness,
    flags: {
      egoSpike, volatilityRisk, alteredStateRisk, needsStabilize,
      isPlayful, isCasual, pushBias, confidence, reasons,
    },
  };
}

export function summarizeEngineOutput(out: EngineOutput) {
  return {
    mode: out.mode,
    warmth: out.warmth,
    directness: out.directness,
    reflectionDepth: out.reflectionDepth,
    flags: out.flags,
  };
}

export default runPersonalityEngine;
