// src/lib/personaState.ts
// 🧠 Persona Engine v1 — lightweight, safe user modeling (server-side)
// Goal: produce a compact "User Model Snapshot" for prompt conditioning.
// Scope:
// - No UI changes
// - No DB writes (yet) — pure derivation from provided signals + recent LTM memories passed in
// - Explicitly avoid sensitive/creepy storage
//
// This module is designed to be deterministic and bounded.
// It extracts only stable, user-stated preferences/goals/constraints and communication style.
// It deliberately avoids: precise location, financial account IDs, medical diagnoses, sexuality, politics, religion, etc.

export type PersonaPreference = {
  key: string;          // e.g. "favorite_drink"
  value: string;        // e.g. "Steri Stumpie"
  confidence: number;   // 0..1
  source: "memory" | "reflection" | "diary" | "chat";
};

export type PersonaGoal = {
  goal: string;         // e.g. "Build Alina v5 MVP"
  horizon: "today" | "week" | "month" | "year" | "long_term" | "unknown";
  confidence: number;   // 0..1
  source: "memory" | "reflection" | "diary" | "chat";
};

export type PersonaConstraint = {
  constraint: string;   // e.g. "ONE step at a time"
  importance: "low" | "medium" | "high";
  source: "memory" | "reflection" | "diary" | "chat";
};

export type PersonaStyle = {
  tone: "direct" | "warm" | "playful" | "clinical" | "balanced";
  verbosity: "low" | "medium" | "high";
  questionRate: "low" | "medium" | "high";
};

export type PersonaSnapshot = {
  version: "persona_v1";
  updatedAtIso: string;

  preferences: PersonaPreference[];
  goals: PersonaGoal[];
  constraints: PersonaConstraint[];
  style: PersonaStyle;

  // A short natural-language summary used in the system prompt.
  // Must not contain sensitive data.
  summary: string;
};

type LtmLike = {
  createdAt?: string;
  source?: string;
  summary?: string;
  tags?: string[];
  mood?: string;
  confidence?: number;
  extra?: Record<string, any>;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function nowIso() {
  return new Date().toISOString();
}

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

function uniqBy<T>(arr: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Very conservative redaction filter:
 * - Avoid emails, phone numbers, URLs
 * - Avoid long digit sequences that look like IDs
 */
export function redactSensitive(text: string): string {
  let t = text;

  // emails
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
  // phone-ish
  t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]");
  // urls
  t = t.replace(/https?:\/\/\S+/gi, "[redacted-url]");
  // long id-ish digit runs
  t = t.replace(/\b\d{8,}\b/g, "[redacted-id]");

  return t;
}

/**
 * Extract a small set of stable "constraints" that the user explicitly set as rules.
 */
function extractConstraintsFromText(text: string): PersonaConstraint[] {
  const t = norm(text).toLowerCase();
  const out: PersonaConstraint[] = [];

  const add = (constraint: string, importance: PersonaConstraint["importance"]) => {
    out.push({ constraint, importance, source: "chat" });
  };

  if (t.includes("one step at a time") || t.includes("one step only")) {
    add("ONE step at a time (no overwhelm).", "high");
  }
  if (t.includes("full file") || t.includes("full updated file")) {
    add("When editing code: always return FULL files.", "high");
  }
  if (t.includes("downloadable") || t.includes("download")) {
    add("Prefer downloadable files over pasted code.", "high");
  }
  if (t.includes("no ui changes")) {
    add("No UI changes unless explicitly requested.", "high");
  }
  if (t.includes("no feature creep")) {
    add("No feature creep: keep scope tight.", "high");
  }

  return out;
}

/**
 * Extract preference candidates from known patterns.
 * This is intentionally limited — expand later only with explicit intent.
 */
function extractPreferencesFromText(text: string, source: PersonaPreference["source"]): PersonaPreference[] {
  const raw = norm(text);
  const t = raw.toLowerCase();
  const out: PersonaPreference[] = [];

  // Favorite drink patterns
  // e.g., "my favorite drink is Steri Stumpie"
  const favDrinkMatch = raw.match(/favorite\s+drink\s+(is|=)\s+([^\n.!,]{2,60})/i);
  if (favDrinkMatch?.[2]) {
    out.push({
      key: "favorite_drink",
      value: redactSensitive(favDrinkMatch[2].trim()),
      confidence: 0.78,
      source,
    });
  }

  // Favorite cupcake flavor patterns
  const favCupcakeMatch = raw.match(/favorite\s+cupcake\s+(flavor|flavour)\s+(is|=)\s+([^\n.!,]{2,60})/i);
  if (favCupcakeMatch?.[3]) {
    out.push({
      key: "favorite_cupcake_flavor",
      value: redactSensitive(favCupcakeMatch[3].trim()),
      confidence: 0.74,
      source,
    });
  }

  // Communication preferences (simple)
  if (t.includes("one paragraph")) {
    out.push({
      key: "response_format",
      value: "One paragraph max (when requested).",
      confidence: 0.72,
      source,
    });
  }

  return out;
}

/**
 * Extract goals from text via very lightweight heuristics.
 */
function extractGoalsFromText(text: string, source: PersonaGoal["source"]): PersonaGoal[] {
  const t = norm(text).toLowerCase();
  const out: PersonaGoal[] = [];

  const add = (goal: string, horizon: PersonaGoal["horizon"], confidence: number) => {
    out.push({ goal: redactSensitive(goal), horizon, confidence: clamp(confidence, 0.2, 0.92), source });
  };

  if (t.includes("start the business")) add("Start the business (ship + monetize).", "month", 0.72);
  if (t.includes("build alina") || t.includes("alina v5")) add("Build Alina v5 (core companion + systems).", "long_term", 0.82);
  if (t.includes("personality") && t.includes("stabil")) add("Stabilize Alina's personality (deterministic + bounded).", "week", 0.76);

  return out;
}

/**
 * Infer user communication style from constraints + recent messages.
 */
function inferStyle(params: { constraints: PersonaConstraint[]; recentUserText?: string }): PersonaStyle {
  const c = params.constraints.map((x) => x.constraint.toLowerCase()).join(" | ");
  const t = norm(params.recentUserText).toLowerCase();

  let verbosity: PersonaStyle["verbosity"] = "medium";
  if (c.includes("one paragraph") || c.includes("low overwhelm")) verbosity = "low";

  let questionRate: PersonaStyle["questionRate"] = "low";
  if (t.includes("?") && (t.match(/\?/g) ?? []).length >= 2) questionRate = "medium";

  let tone: PersonaStyle["tone"] = "balanced";
  if (t.includes("no fluff") || c.includes("scope tight")) tone = "direct";
  if (t.includes("playful") || t.includes("fun")) tone = "playful";

  return { tone, verbosity, questionRate };
}

export function buildPersonaSnapshot(params: {
  recentUserText?: string | null;
  reflectionSummary?: string | null;
  diary?: string | null;
  recentMemories?: LtmLike[] | null;
}): PersonaSnapshot {
  const recentUserText = norm(params.recentUserText ?? "");
  const reflection = norm(params.reflectionSummary ?? "");
  const diary = norm(params.diary ?? "");
  const memories = (params.recentMemories ?? []).filter(Boolean);

  // Constraints: from recentUserText + reflection/diary (only if explicitly rules)
  const constraintsRaw = [
    ...extractConstraintsFromText(recentUserText),
    ...extractConstraintsFromText(reflection),
    ...extractConstraintsFromText(diary),
  ];

  // Preferences: from reflection/diary + recentUserText + memory summaries
  const prefFromChat = extractPreferencesFromText(recentUserText, "chat");
  const prefFromReflection = extractPreferencesFromText(reflection, "reflection");
  const prefFromDiary = extractPreferencesFromText(diary, "diary");

  const prefFromMem = memories.flatMap((m) =>
    extractPreferencesFromText(norm(m.summary ?? ""), "memory").map((p) => ({
      ...p,
      confidence: clamp((m.confidence ?? 0.7) * p.confidence, 0.2, 0.92),
    }))
  );

  let preferences = uniqBy(
    [...prefFromChat, ...prefFromReflection, ...prefFromDiary, ...prefFromMem],
    (p) => p.key
  );

  // Goals
  const goals = uniqBy(
    [
      ...extractGoalsFromText(recentUserText, "chat"),
      ...extractGoalsFromText(reflection, "reflection"),
      ...extractGoalsFromText(diary, "diary"),
      ...memories.flatMap((m) => extractGoalsFromText(norm(m.summary ?? ""), "memory")),
    ],
    (g) => g.goal
  ).slice(0, 8);

  // Constraints de-dup
  const constraints = uniqBy(constraintsRaw, (c) => c.constraint).slice(0, 10);

  const style = inferStyle({ constraints, recentUserText });

  // Build a compact summary (safe + non-creepy)
  const prefBits = preferences
    .slice(0, 5)
    .map((p) => `${p.key.replace(/_/g, " ")}=${p.value}`)
    .join("; ");

  const goalBits = goals
    .slice(0, 4)
    .map((g) => g.goal)
    .join(" | ");

  const constraintBits = constraints
    .slice(0, 4)
    .map((c) => c.constraint)
    .join(" | ");

  const summary = redactSensitive(
    [
      prefBits ? `Preferences: ${prefBits}.` : "",
      goalBits ? `Goals: ${goalBits}.` : "",
      constraintBits ? `Constraints: ${constraintBits}.` : "",
      `Style: tone=${style.tone}, verbosity=${style.verbosity}, questions=${style.questionRate}.`,
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
  );

  return {
    version: "persona_v1",
    updatedAtIso: nowIso(),
    preferences,
    goals,
    constraints,
    style,
    summary,
  };
}

/**
 * Format for prompt injection.
 * Keep it short; model should not "overfit" to it.
 */
export function personaSnapshotToPromptBlock(snapshot: PersonaSnapshot): string {
  const lines: string[] = [];

  lines.push("[USER MODEL SNAPSHOT — NON-SENSITIVE]");
  lines.push(`Updated: ${snapshot.updatedAtIso}`);
  lines.push(`Style: tone=${snapshot.style.tone}, verbosity=${snapshot.style.verbosity}, questions=${snapshot.style.questionRate}`);

  if (snapshot.constraints.length) {
    lines.push("Constraints:");
    for (const c of snapshot.constraints.slice(0, 6)) {
      lines.push(`- ${c.constraint}`);
    }
  }

  if (snapshot.goals.length) {
    lines.push("Goals:");
    for (const g of snapshot.goals.slice(0, 6)) {
      lines.push(`- (${g.horizon}) ${g.goal}`);
    }
  }

  if (snapshot.preferences.length) {
    lines.push("Preferences:");
    for (const p of snapshot.preferences.slice(0, 8)) {
      lines.push(`- ${p.key.replace(/_/g, " ")}: ${p.value}`);
    }
  }

  lines.push("Rules:");
  lines.push("- Use this snapshot to tailor tone + format.");
  lines.push("- Do not mention the snapshot explicitly.");
  lines.push("- If a personal fact is missing, do not guess.");

  return lines.join("\n");
}
