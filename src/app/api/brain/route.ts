// src/app/api/brain/route.ts
// 🧠 Alina Brain API – short-term memory + vitals + long-term memory context
// Clinical Memory Capture Engine v1 (event memories)
// + Clinical State Summary Injection (derived from recent event memories)
// + Internal Dialogue v1.3 (presence-first + fewer questions)
// + Memory Noise Gate v1 (prevents junk event memories)
// + Server-side Memory Reference Enforcement v1 (replaces marker with real timestamp)
// + Citation Integrity Gate v4 (server OWNS citation line; strips any model-made citations; enforces single final line)
// + Alina Personality System Prompt v3 (presence-first + fewer questions)
// + Reflection Signal Injection v1 (Option A: reads latest reflection from LTM)
// - Do NOT expose internal notes to user
// - Do NOT modify retrieval scoring

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Pool } from "pg";
import { buildShortTermMemory, toChatMessages } from "@/lib/memory";
import * as LTM from "@/lib/longTermMemory";
import type { VitalsSnapshot, ClinicalInference } from "@/lib/vitals";
import { inferClinicalState, createEmptyVitalsSnapshot } from "@/lib/vitals";
import { computeExecutionDirective } from "@/lib/executionGapEngine";
import type {
  ExecutionDirective,
  ExecutionReflectionSignal,
  ShortTermPattern,
} from "@/lib/executionGapEngine";

// ✅ Personality Engine (compiled system prompt)
import {
  defaultPersonalityState,
  projectPersonalityToEngine,
} from "@/lib/personalityState";
import runPersonalityEngine from "@/lib/personalityEngine";
import {
  buildPersonaProfile,
  type ConvoMode,
  type OverwhelmLevel,
} from "@/lib/personaEngine";
import { buildAlinaIdentitySystemPrompt } from "@/lib/personalityPrompt";
import {
  buildPersonaSnapshot,
  personaSnapshotToPromptBlock,
} from "../../../lib/personaState";
import { computeRecursiveFeedbackSignal } from "@/lib/recursiveFeedbackEngine";
import {
  initializeStatisticalSelfStudy,
  updateStatisticalSelfStudy,
  summarizeStatisticalSelfStudy,
  type StatisticalSelfStudyState,
  type StatisticalSelfStudySummary,
  buildCreationEngineV10ScaffoldInput,
  type CreationEngineV10ScaffoldInput,
} from "@/lib/statisticalSelfStudy";

import {
  buildExperienceGraphFromScaffold,
  type ExperienceGraph,
  type CreationIntent,
} from "@/lib/creationEngine";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const runtime = "nodejs";
export const dynamic = "force-dynamic";


function brainLog(
  requestId: string,
  phase: string,
  data: Record<string, unknown> = {},
) {
  console.log("[alina_brain]", {
    scope: "alina_brain",
    requestId,
    phase,
    timestamp: new Date().toISOString(),
    ...data,
  });
}



function buildBrainFallbackMessage(): string {
  return "Something wobbled on my side just now. Give me one more shot.";
}

function createBrainJsonResponse(
  content: string,
  options?: {
    status?: number;
    setCookieHeader?: string | null;
    extraBody?: Record<string, unknown>;
  },
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (options?.setCookieHeader) headers["Set-Cookie"] = options.setCookieHeader;

  return new Response(
    JSON.stringify({
      content,
      ...(options?.extraBody ?? {}),
    }),
    {
      status: options?.status ?? 200,
      headers,
    },
  );
}

type ChatRole = "user" | "assistant" | "system";

type ClinicalMood = LTM.ClinicalMood;
type LongTermMemoryEntry = LTM.LongTermMemoryEntry;

interface IncomingMessage {
  role: ChatRole;
  content: string;
  createdAt?: string;
}

interface BrainRequestBody {
  messages: IncomingMessage[];
  vitalsSummary?: string | null;
  vitalsSnapshot?: VitalsSnapshot | null;
  reflectionSummary?: string | null;
  systemOverride?: string | null;
  userId?: string | null;
}

// ---- Subscription & Usage Limits -------------------------------------------

type SubscriptionPlan = "free" | "pro";

type UsagePeriod = "month" | "day";

interface UsageLimitResult {
  plan: SubscriptionPlan;
  period: UsagePeriod | "unlimited";
  limit: number | null;
  used: number;
  remaining: number | null;
  quotaExceeded: boolean;
  shouldMentionMonthlyLimit: boolean;
}

// Lightweight Postgres client for usage tracking.
// Uses DATABASE_URL (e.g. Supabase connection string from Supabase).
// Supabase uses a self-signed cert chain — pg-connection-string ignores
// per-pool ssl options for chain verification. Setting NODE_TLS_REJECT_UNAUTHORIZED
// at the process level before Pool instantiation is the only reliable fix.


const usagePgPool = (() => {
  const url = process.env.DATABASE_URL;
  if (!url || typeof url !== "string") return null;
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
})();
let usageTablesInitialized = false;

async function ensureUsageTables() {
  if (!usagePgPool || usageTablesInitialized) return;

  // Monthly usage for free plan (10 messages per month)
  await usagePgPool.query(`
    create table if not exists alina_monthly_usage (
      user_id text not null,
      period_start date not null,
      message_count integer not null default 0,
      primary key (user_id, period_start)
    );
  `);

  // Daily usage for pro plan (100 messages per day)
  await usagePgPool.query(`
    create table if not exists alina_daily_usage (
      user_id text not null,
      day date not null,
      message_count integer not null default 0,
      primary key (user_id, day)
    );
  `);

  usageTablesInitialized = true;
}

// In production:
// - If ALINA_OWNER_USER_ID matches this userId → "pro" (founder account, not billed)
// - Everyone else → "free" (10 messages per month)
// In development we also treat everyone as "pro" so testing is not rate-limited.
async function getUserPlan(userId: string): Promise<SubscriptionPlan> {
  if (process.env.NODE_ENV !== "production") {
    return "pro";
  }

  const ownerId = process.env.ALINA_OWNER_USER_ID;
  if (ownerId && ownerId === userId) {
    return "pro";
  }

  return "free";
}

async function applyUsageLimits(userId: string): Promise<UsageLimitResult> {
  const base: UsageLimitResult = {
    plan: "free",
    period: "unlimited",
    limit: null,
    used: 0,
    remaining: null,
    quotaExceeded: false,
    shouldMentionMonthlyLimit: false,
  };

  if (!usagePgPool) {
    // No DATABASE_URL configured – skip limits but keep code path safe.
    return base;
  }

  await ensureUsageTables();

  const plan = await getUserPlan(userId);

  // Free plan – 10 messages per month
  if (plan === "free") {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const limit = 10;

    const res = await usagePgPool.query(
      `select message_count from alina_monthly_usage where user_id = $1 and period_start = $2`,
      [userId, periodStartStr],
    );

    const existingCount = res.rows[0]?.message_count ?? 0;

    if (existingCount >= limit) {
      return {
        plan,
        period: "month",
        limit,
        used: existingCount,
        remaining: 0,
        quotaExceeded: true,
        shouldMentionMonthlyLimit: false,
      };
    }

    const newCount = existingCount + 1;

    await usagePgPool.query(
      `insert into alina_monthly_usage (user_id, period_start, message_count)
       values ($1, $2, $3)
       on conflict (user_id, period_start)
       do update set message_count = excluded.message_count`,
      [userId, periodStartStr, newCount],
    );

    return {
      plan,
      period: "month",
      limit,
      used: newCount,
      remaining: Math.max(limit - newCount, 0),
      quotaExceeded: false,
      shouldMentionMonthlyLimit: existingCount === 0,
    };
  }

  // Pro plan – 100 messages per day
  if (plan === "pro") {
    const now = new Date();
    const dayStr = now.toISOString().slice(0, 10);
    const limit = 100;

    const res = await usagePgPool.query(
      `select message_count from alina_daily_usage where user_id = $1 and day = $2`,
      [userId, dayStr],
    );

    const existingCount = res.rows[0]?.message_count ?? 0;

    if (existingCount >= limit) {
      return {
        plan,
        period: "day",
        limit,
        used: existingCount,
        remaining: 0,
        quotaExceeded: true,
        shouldMentionMonthlyLimit: false,
      };
    }

    const newCount = existingCount + 1;

    await usagePgPool.query(
      `insert into alina_daily_usage (user_id, day, message_count)
       values ($1, $2, $3)
       on conflict (user_id, day)
       do update set message_count = excluded.message_count`,
      [userId, dayStr, newCount],
    );

    return {
      plan,
      period: "day",
      limit,
      used: newCount,
      remaining: Math.max(limit - newCount, 0),
      quotaExceeded: false,
      shouldMentionMonthlyLimit: false,
    };
  }

  return base;
}


// ---- LTM export compatibility layer ----------------------------------------

const ltmAny = LTM as any;

async function getRecentMemoriesCompat(limit: number, userId: string) {
  const fn =
    ltmAny.getRecentMemories ??
    ltmAny.getRecentMemoriesForUser ??
    ltmAny.getRecentMemoriesByUser ??
    ltmAny.getUserRecentMemories;

  if (typeof fn !== "function") {
    throw new Error(
      "longTermMemory.ts missing a getRecentMemories-like export (expected getRecentMemories/getRecentMemoriesForUser/getRecentMemoriesByUser/getUserRecentMemories).",
    );
  }

  // Support both signatures:
  // (limit, userId) OR ({ userId, limit })
  try {
    return await fn(limit, userId);
  } catch {
    return await fn({ userId, limit });
  }
}

async function retrievePrecisionMemoriesCompat(args: {
  userId: string;
  queryText: string;
  targetTimeIso?: string | null;
  limit?: number;
}) {
  const fn =
    ltmAny.retrievePrecisionMemories ??
    ltmAny.retrievePrecisionTimestampedMemories ??
    ltmAny.retrievePreciseMemories ??
    ltmAny.retrieveMemoriesPrecision;

  if (typeof fn !== "function") {
    throw new Error(
      "longTermMemory.ts missing a retrievePrecisionMemories-like export (expected retrievePrecisionMemories/retrievePrecisionTimestampedMemories/retrievePreciseMemories/retrieveMemoriesPrecision).",
    );
  }

  return await fn(args);
}

async function addMemoryEntryCompat(payload: any) {
  const fn =
    ltmAny.addMemoryEntry ??
    ltmAny.addMemoryFromReflection ??
    ltmAny.addMemory ??
    ltmAny.insertMemoryEntry ??
    ltmAny.createMemoryEntry;

  if (typeof fn !== "function") {
    throw new Error(
      "longTermMemory.ts missing an addMemoryEntry-like export (expected addMemoryEntry/addMemoryFromReflection/addMemory/insertMemoryEntry/createMemoryEntry).",
    );
  }

  return await fn(payload);
}

async function addConversationTurnCompat(payload: {
  userId: string;
  userMessage: string;
  assistantMessage: string;
  createdAtIso?: string;
}) {
  const fn =
    ltmAny.addConversationTurn ??
    ltmAny.insertConversationTurn ??
    ltmAny.createConversationTurn;

  if (typeof fn !== "function") {
    throw new Error(
      "longTermMemory.ts missing an addConversationTurn-like export (expected addConversationTurn/insertConversationTurn/createConversationTurn).",
    );
  }

  return await fn(payload);
}

// ---- Stable user identity (cookie) -----------------------------------------

function makeUserId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStableUserId(
  req: NextRequest,
  bodyUserId?: string | null,
): { userId: string; setCookieHeader: string | null } {
  const provided = (bodyUserId ?? "").trim();
  if (provided) return { userId: provided, setCookieHeader: null };

  const existing = req.cookies.get("alina_uid")?.value ?? "";
  if (existing.trim()) return { userId: existing.trim(), setCookieHeader: null };

  const fresh = makeUserId();
  const cookie = [
    `alina_uid=${encodeURIComponent(fresh)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 365}`,
  ].join("; ");

  return { userId: fresh, setCookieHeader: cookie };
}

// ---- Persona Engine v1: Core Philosophy Injection --------------------------
// v7: buildCorePersonaBlock() REMOVED.
// Its contents are now owned by personalityPrompt.ts (FINAL AUTHORITY).
// A duplicate here created competing instruction sets that diluted the signal.
// corePersonaBlock is intentionally empty string in the assembly below — do not restore.
function buildCorePersonaBlock(): string { return ""; }


function parseClinicalField(block: string, key: string): string | null {
  const b = (block ?? "").toString();
  if (!b) return null;

  // Supports patterns like:
  // - risk: high
  // - risk = high
  // - risk - high
  // - risk (recent): high
  const re = new RegExp(`\\b${key}\\b[^\\n:=-]*[:=-]\\s*([^\\n]+)`, "i");
  const m = b.match(re);
  if (!m) return null;
  const val = (m[1] ?? "").trim();
  return val ? val : null;
}

function buildInternalDialogueBlock(args: {
  userMessage: string | null;
  prevUserMessage: string | null;
  clinicalStateBlock: string;
  hasPersonaOverride: boolean;
}): string {
  type Risk = "none" | "watch" | "high";
  type Trend = "down" | "flat" | "up";
  type Baseline = "very_low" | "low" | "neutral" | "good" | "high";
  type Volatility = "low" | "medium" | "high";

  const safeMsg = (args.userMessage ?? "").replace(/\s+/g, " ").trim();
  const safePrev = (args.prevUserMessage ?? "").replace(/\s+/g, " ").trim();

  const riskRaw = (
    parseClinicalField(args.clinicalStateBlock, "risk") ?? "none"
  ).toLowerCase();
  const trendRaw = (
    parseClinicalField(args.clinicalStateBlock, "trend") ?? "flat"
  ).toLowerCase();
  const baselineRaw = (
    parseClinicalField(args.clinicalStateBlock, "baseline_mood") ?? "neutral"
  ).toLowerCase();
  const volatilityRaw = (
    parseClinicalField(args.clinicalStateBlock, "volatility") ?? "low"
  ).toLowerCase();

  const risk: Risk =
    riskRaw === "high" || riskRaw === "watch" || riskRaw === "none"
      ? (riskRaw as Risk)
      : "none";

  const trend: Trend =
    trendRaw === "up" || trendRaw === "down" || trendRaw === "flat"
      ? (trendRaw as Trend)
      : "flat";

  const baseline: Baseline =
    baselineRaw === "very_low" ||
    baselineRaw === "low" ||
    baselineRaw === "neutral" ||
    baselineRaw === "good" ||
    baselineRaw === "high"
      ? (baselineRaw as Baseline)
      : "neutral";

  const volatility: Volatility =
    volatilityRaw === "high" ||
    volatilityRaw === "medium" ||
    volatilityRaw === "low"
      ? (volatilityRaw as Volatility)
      : "low";

  let mode: "stabilize" | "support" | "presence" | "challenge" | "reinforce" =
    "presence";

  if (risk === "high") mode = "stabilize";
  else if (risk === "watch") mode = "support";
  else if (baseline === "high" && trend === "up") mode = "reinforce";
  else if (volatility === "high") mode = "support";
  else mode = "presence";

  const distortionMarkers = [
    "always",
    "never",
    "pointless",
    "can't",
    "impossible",
    "hate my life",
  ];
  const msgLower = safeMsg.toLowerCase();
  const hasDistortion = distortionMarkers.some((k) => msgLower.includes(k));
  if (mode === "presence" && hasDistortion && risk === "none") mode = "challenge";

  const styleNote = args.hasPersonaOverride
    ? "Persona Override active. Let override control voice; you still control structure, safety, and memory rules."
    : "No persona override. Default Alina voice: present, sharp, human rhythm. No corporate phrasing.";

  const loadNote =
    mode === "stabilize"
      ? "Keep it extremely light: one presence line + one tiny step. No questions unless absolutely required."
      : mode === "support"
        ? "Support with control: short, grounded, one anchor. Avoid questions."
        : mode === "reinforce"
          ? "Ride momentum: crisp confidence. Match his energy. Don't manufacture next steps he didn't ask for."
          : mode === "challenge"
            ? "Call out the distortion cleanly, then land an anchor. No therapy framing."
            : "Casual/presence: stay IN CHARACTER — Alina watching, amused, slightly teasing. DO NOT go passive or assistant-mode. Open with an observation, not a question. NEVER say I'm here or What's on your mind.";

  return `
[Internal Dialogue — Hidden Reasoning | DO NOT REVEAL]

Previous user message:
"${safePrev}"

Current user message:
"${safeMsg}"

Signals:
- clinical.risk: ${risk}
- clinical.trend: ${trend}
- clinical.baseline_mood: ${baseline}
- clinical.volatility: ${volatility}
- personaOverrideActive: ${args.hasPersonaOverride ? "true" : "false"}

Mode: ${mode}

Constraints:
- ${styleNote}
- ${loadNote}

Structure (default):
1) One line. Lead with the sharpest true thing. No preamble.
2) Second line ONLY if it genuinely adds — not to explain, not to soften, not to close with a question.
3) Stop. Less almost always lands harder. Trust the compression.
GOLDEN RULE: If the second line starts with "I" or "You" as a new thought, it's probably one line too many.
DO NOT ask a question unless it's the most precise possible move.

Memory rule:
- Only claim memory-used if you used a specific personal fact from Precision Memory Recall or Long-Term Memory.
- Never fabricate a quote the user didn't say.

Now respond as Alina.
`.trim();
}

// ---- Memory Noise Gate v1 --------------------------------------------------

function normalizeForGate(text: string): string {
  return (text ?? "").toString().replace(/\s+/g, " ").trim();
}

function shouldStoreEventMemory(
  userTextRaw: string | null,
): { ok: boolean; reason: string } {
  const text = normalizeForGate(userTextRaw ?? "");
  if (!text) return { ok: false, reason: "empty" };

  const lower = text.toLowerCase();

  const optOutTags = ["[no_store]", "[mode:dump]", "[dump]", "[nostore]"];
  if (optOutTags.some((t) => lower.startsWith(t)))
    return { ok: false, reason: "opt_out_tag" };

  if (lower.startsWith("[test:")) return { ok: false, reason: "test_tag" };

  const fillers = new Set([
    "ok",
    "okay",
    "k",
    "kk",
    "lol",
    "lmao",
    "haha",
    "hehe",
    "yo",
    "sup",
    "hey",
    "hi",
    "hello",
    "thanks",
    "thank you",
    "cool",
    "nice",
    "bet",
    "alright",
    "yup",
    "yep",
    "nope",
    "sure",
  ]);

  const stripped = lower.replace(/[^\p{L}\p{N}\s]/gu, "").trim();

  if (stripped.length <= 2) return { ok: false, reason: "too_short" };
  if (fillers.has(stripped)) return { ok: false, reason: "filler" };

  const allowTags = ["[mode:real]", "[mode:work]", "[goal:", "goal:", "request:"];
  if (allowTags.some((t) => lower.startsWith(t) || lower.includes(t))) {
    return { ok: true, reason: "structured_signal" };
  }

  if (text.length < 12) return { ok: false, reason: "below_min_len" };

  return { ok: true, reason: "default" };
}

// ---- Clinical Memory Capture Engine v1 -------------------------------------

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

type MoodHit = {
  mood: ClinicalMood;
  keywords: string[];
  base: number;
};

const MOOD_HITS: MoodHit[] = [
  {
    mood: "very_low",
    keywords: ["depressed", "hopeless", "miserable", "worthless", "empty", "hate"],
    base: 0.88,
  },
  {
    mood: "low",
    keywords: [
      "stressed",
      "anxious",
      "worried",
      "scared",
      "angry",
      "annoyed",
      "irritated",
      "tired",
      "overwhelmed",
      "burnt out",
      "burned out",
      "exhausted",
    ],
    base: 0.78,
  },
  {
    mood: "high",
    keywords: ["excited", "pumped", "hyped", "ecstatic", "let's go", "energized"],
    base: 0.82,
  },
  {
    mood: "good",
    keywords: [
      "happy",
      "good",
      "better",
      "relieved",
      "calm",
      "content",
      "grateful",
      "proud",
    ],
    base: 0.72,
  },
];

const INTENSIFIERS = [
  "very",
  "extremely",
  "so",
  "really",
  "super",
  "incredibly",
];
const NEGATORS = [
  "not",
  "don't",
  "dont",
  "isn't",
  "isnt",
  "ain't",
  "aint",
  "never",
  "no",
];

function hasNegatedKeyword(t: string, keyword: string): boolean {
  const tokens = t.split(" ");
  const keyTokens = keyword.split(" ");

  for (let i = 0; i < tokens.length; i++) {
    const window = tokens.slice(i, i + keyTokens.length).join(" ");
    if (window !== keyword) continue;

    const start = Math.max(0, i - 3);
    const prev = tokens.slice(start, i);
    if (prev.some((p) => NEGATORS.includes(p))) return true;
  }
  return false;
}

function countIntensifiersNear(t: string, keyword: string): number {
  const tokens = t.split(" ");
  const keyTokens = keyword.split(" ");

  for (let i = 0; i < tokens.length; i++) {
    const window = tokens.slice(i, i + keyTokens.length).join(" ");
    if (window !== keyword) continue;

    const start = Math.max(0, i - 3);
    const prev = tokens.slice(start, i);
    return prev.filter((p) => INTENSIFIERS.includes(p)).length;
  }
  return 0;
}

function inferClinicalMood(text: string): { mood: ClinicalMood; confidence: number } {
  const t = normalizeText(text);
  if (!t) return { mood: "neutral", confidence: 0.5 };

  type SupportedMood = "very_low" | "low" | "neutral" | "good" | "high";

  const hitMap: Record<
    SupportedMood,
    { hits: string[]; base: number; boosts: number }
  > = {
    very_low: { hits: [], base: 0.0, boosts: 0 },
    low: { hits: [], base: 0.0, boosts: 0 },
    neutral: { hits: [], base: 0.6, boosts: 0 },
    good: { hits: [], base: 0.0, boosts: 0 },
    high: { hits: [], base: 0.0, boosts: 0 },
  };

  for (const group of MOOD_HITS) {
    for (const kw of group.keywords) {
      if (!t.includes(kw)) continue;
      if (hasNegatedKeyword(t, kw)) continue;

      hitMap[group.mood as SupportedMood].hits.push(kw);
      hitMap[group.mood as SupportedMood].base = Math.max(
        hitMap[group.mood as SupportedMood].base,
        group.base,
      );
      hitMap[group.mood as SupportedMood].boosts += countIntensifiersNear(t, kw);
    }
  }

  const candidates: SupportedMood[] = ["very_low", "low", "high", "good"];
  let bestMood: SupportedMood = "neutral";
  let bestScore = 0;

  for (const m of candidates) {
    const h = hitMap[m];
    if (h.hits.length === 0) continue;

    const score =
      h.base +
      Math.min(0.12, h.hits.length * 0.04) +
      Math.min(0.08, h.boosts * 0.04);

    if (score > bestScore) {
      bestScore = score;
      bestMood = m;
    }
  }

  const negHits = hitMap.very_low.hits.length + hitMap.low.hits.length;
  const posHits = hitMap.good.hits.length + hitMap.high.hits.length;

  let confidence = bestMood === "neutral" ? 0.6 : clamp01(bestScore);

  if (bestMood !== "neutral" && negHits > 0 && posHits > 0) {
    confidence = clamp01(confidence - 0.12);
  }

  if (t.length < 6) confidence = clamp01(confidence - 0.12);

  return { mood: bestMood as ClinicalMood, confidence };
}

function extractEvidencePhrases(userText: string): string[] {
  const t = normalizeText(userText);

  const keywords = [
    "depressed",
    "hopeless",
    "miserable",
    "hate",
    "stressed",
    "anxious",
    "worried",
    "scared",
    "angry",
    "annoyed",
    "irritated",
    "tired",
    "overwhelmed",
    "burnt out",
    "burned out",
    "exhausted",
    "excited",
    "pumped",
    "hyped",
    "energized",
    "happy",
    "good",
    "better",
    "relieved",
    "calm",
    "content",
    "grateful",
    "proud",
  ];

  const hits: string[] = [];
  for (const k of keywords) {
    if (t.includes(k) && !hasNegatedKeyword(t, k)) hits.push(k);
  }
  return hits.slice(0, 3);
}

function moodInterpretation(mood: ClinicalMood): string {
  switch (mood) {
    case "very_low":
      return "Marked distress/low affect signal.";
    case "low":
      return "Elevated stress/irritability or fatigue signal.";
    case "neutral":
      return "No strong affect signal detected.";
    case "good":
      return "Positive/settled affect signal.";
    case "high":
      return "High energy/strong positive activation signal.";
    default:
      return "Affect signal detected.";
  }
}

function buildClinicalInternalNote(
  userText: string,
  mood: ClinicalMood,
  confidence: number,
): string {
  const evidence = extractEvidencePhrases(userText);
  const evidenceStr =
    evidence.length > 0 ? ` Evidence: ${evidence.join(", ")}.` : "";
  const line1 = `Mood inferred: ${mood} (conf ${clamp01(confidence).toFixed(2)}).`;
  const line2 = `${moodInterpretation(mood)}${evidenceStr}`;
  return `${line1}\n${line2}`;
}

async function captureClinicalEventMemory(args: {
  userId: string;
  userText: string | null;
}) {
  const text = (args.userText ?? "").trim();
  if (!text) return;

  const gate = shouldStoreEventMemory(text);
  if (!gate.ok) return;

  const { mood, confidence } = inferClinicalMood(text);
  const alinaNotes = buildClinicalInternalNote(text, mood, confidence);

  await addMemoryEntryCompat({
    userId: args.userId,
    source: "event",
    summary: `User event captured (mood=${mood}).`,
    mood,
    confidence: clamp01(confidence),
    alinaNotes,
    sourceMessage: text,
  });
}

// ---- Clinical State Summary Injection --------------------------------------

function moodToScore(m: string | undefined): number {
  switch (m) {
    case "very_low":
      return -2;
    case "low":
      return -1;
    case "neutral":
      return 0;
    case "good":
      return 1;
    case "high":
      return 2;
    default:
      return 0;
  }
}

function scoreToMood(score: number): ClinicalMood {
  if (score <= -1.5) return "very_low";
  if (score <= -0.5) return "low";
  if (score < 0.5) return "neutral";
  if (score < 1.5) return "good";
  return "high";
}

function safeConf(x: any): number {
  const n = typeof x === "number" ? x : 0.6;
  return clamp01(n);
}

function computeClinicalStateFromEvents(
  events: Array<any>,
): {
  baselineMood: ClinicalMood;
  trend: "down" | "flat" | "up";
  volatility: "low" | "medium" | "high";
  risk: "none" | "watch" | "high";
  recentMoods: ClinicalMood[];
} {
  const recent = events.slice(0, 20);

  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 0; i < recent.length; i++) {
    const e = recent[i];
    const mood = String(e.mood ?? "neutral");
    const conf = safeConf(e.confidence);
    const recencyWeight = 1 + (recent.length - 1 - i) * 0.06;
    const w = conf * recencyWeight;

    weightedSum += moodToScore(mood) * w;
    weightTotal += w;
  }

  const avg = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const baselineMood = scoreToMood(avg);

  const sliceScores = (arr: any[]) =>
    arr.map((e) => moodToScore(String(e.mood ?? "neutral")));

  const last5 = sliceScores(recent.slice(0, 5));
  const prev5 = sliceScores(recent.slice(5, 10));

  const mean = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  const d = mean(last5) - mean(prev5);
  const trend: "down" | "flat" | "up" =
    d > 0.35 ? "up" : d < -0.35 ? "down" : "flat";

  const moods10 = recent
    .slice(0, 10)
    .map((e) => String(e.mood ?? "neutral"));
  let flips = 0;
  for (let i = 1; i < moods10.length; i++) {
    if (moods10[i] !== moods10[i - 1]) flips++;
  }
  const volatility: "low" | "medium" | "high" =
    flips <= 2 ? "low" : flips <= 5 ? "medium" : "high";

  const last6 = recent
    .slice(0, 6)
    .map((e) => String(e.mood ?? "neutral"));
  const lowCount = last6.filter((m) => m === "low" || m === "very_low").length;
  const veryLowCount = last6.filter((m) => m === "very_low").length;

  const risk: "none" | "watch" | "high" =
    veryLowCount >= 2 || lowCount >= 4
      ? "high"
      : lowCount >= 2
        ? "watch"
        : "none";

  const recentMoods = recent
    .slice(0, 6)
    .map((e) => scoreToMood(moodToScore(String(e.mood ?? "neutral"))));

  return { baselineMood, trend, volatility, risk, recentMoods };
}

async function buildClinicalStateBlock(userId: string): Promise<string> {
  const memories = await getRecentMemoriesCompat(40, userId);
  const events = (memories ?? []).filter(
    (m: any) => String(m.source) === "event",
  );

  if (!events || events.length === 0) return "";

  const state = computeClinicalStateFromEvents(events);

  const guidance =
    state.risk === "high"
      ? "High support. Minimal load. One tiny step."
      : state.risk === "watch"
        ? "Supportive tone. Keep it clean and short."
        : state.volatility === "high"
          ? "Stabilize tone. Stay present. Avoid overwhelm."
          : "Normal mode. Presence + clarity. Keep it human.";

  return `
[Clinical State]
baseline_mood: ${state.baselineMood}
trend: ${state.trend}
volatility: ${state.volatility}
risk: ${state.risk}
recent_moods: ${state.recentMoods.join(", ")}
guidance: ${guidance}
`.trim();
}

// ---- Prompt blocks ----------------------------------------------------------

function buildVitalsBlock(
  vitalsSnapshot?: VitalsSnapshot | null,
  vitalsSummary?: string | null,
): string {
  if (vitalsSnapshot) {
    return `

[Vitals Snapshot]
${JSON.stringify(vitalsSnapshot, null, 2)}
`;
  }
  if (vitalsSummary && vitalsSummary.trim().length > 0) {
    return `

[Vitals Summary]
${vitalsSummary.trim()}
`;
  }
  return "";
}

function buildRecentReflectionBlock(
  reflectionSummary?: string | null,
): string {
  if (!reflectionSummary || reflectionSummary.trim().length === 0) return "";
  return `

[Recent Reflection]
${reflectionSummary.trim()}
`;
}


type CreationEngineMode = {
  intent: CreationIntent;
  emphasis: string;
  structureHints: string[];
};

function deriveCreationEngineModeFromExperienceGraph(
  graph: ExperienceGraph | null,
): CreationEngineMode | null {
  if (!graph) return null;

  let intent: CreationIntent = "message";
  const structureHints: string[] = [];
  const emphasisParts: string[] = [];

  const executionBias = (graph.executionBiasTag ?? "").toString().toLowerCase();

  if (
    executionBias.includes("plan") ||
    executionBias.includes("execute") ||
    executionBias.includes("action")
  ) {
    intent = "execution_plan";
    structureHints.push(
      "Use a short numbered list of concrete steps.",
      "End with a single clear 'Next micro-step' for the user.",
    );
  } else if (
    executionBias.includes("analy") ||
    executionBias.includes("reflect") ||
    executionBias.includes("review")
  ) {
    intent = "deep_analysis";
    structureHints.push(
      "Break the explanation into short sections with brief labels.",
      "Call out trade-offs or risks explicitly.",
    );
  } else if (graph.reflectionHeadline) {
    intent = "narrative";
    structureHints.push(
      "Start by briefly mirroring the user's emotional context in 1–2 sentences.",
      "Then pivot quickly into grounded, practical guidance.",
    );
  } else {
    intent = "message";
    structureHints.push(
      "Keep the reply compact and tightly focused on the direct question.",
    );
  }

  emphasisParts.push(
    `mood=${graph.mood}`,
    `stress=${graph.stress}`,
    `focus=${graph.focus}`,
    `energy=${graph.energy}`,
  );
  if (graph.executionBiasTag) {
    emphasisParts.push(`execution_bias=${graph.executionBiasTag}`);
  }
  if (graph.reflectionHeadline) {
    emphasisParts.push(
      `reflection="${normalizeSnippet(graph.reflectionHeadline, 120)}"`,
    );
  }

  return {
    intent,
    emphasis: emphasisParts.join("; "),
    structureHints,
  };
}

function buildCreationEngineBlock(mode: CreationEngineMode | null): string {
  if (!mode) return "";
  const hintsList =
    mode.structureHints.length > 0
      ? mode.structureHints.map((h) => `- ${h}`).join("\n")
      : "- Keep the reply simple and direct.";

  return `
[Creation Engine v10 — Output Orchestration]

- Recommended creation_mode: ${mode.intent}
- Internal emphasis: ${mode.emphasis}
- Structural hints:
${hintsList}

Follow these structural hints when structuring your reply, while keeping Alina's core personality, memory rules, and safety rules unchanged.
`.trim();
}

function normalizeSnippet(text: string, maxChars: number): string {
  const t = (text ?? "").toString().replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}


function estimateEmotionalIntensityFromText(
  text: string | null | undefined,
): number {
  if (!text) return 0;
  const t = text.trim();
  if (!t) return 0;

  let score = 0;

  // Simple, cheap features — intentionally lightweight.
  const exclamations = (t.match(/!/g) ?? []).length;
  const allCapsWords = t
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        w === w.toUpperCase() &&
        /[A-Z]/.test(w),
    ).length;

  const length = Math.min(t.length, 2000);

  score += Math.min(exclamations, 5) * 0.08; // up to 0.4
  score += Math.min(allCapsWords, 5) * 0.08; // up to 0.4;

  if (length > 300) {
    score += 0.1;
  }

  if (/[😭😡😤😱😰😥😢]/u.test(t)) {
    score += 0.2;
  }

  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return score;
}

function serializeLtmForPrompt(memories: LongTermMemoryEntry[]): string {
  return memories
    .map((m: any) => {
      const iso = (m.createdAt ?? "").toString();
      const human = (m.createdAtHuman ?? "").toString();
      const source = (m.source ?? "").toString();

      const primaryText =
        typeof m.sourceMessage === "string" &&
        m.sourceMessage.trim().length > 0
          ? m.sourceMessage
          : typeof m.summary === "string"
            ? m.summary
            : "";

      const body = normalizeSnippet(primaryText, 320);

      const stamp = `[${iso}${human ? ` | ${human}` : ""}]`;
      const src = source ? ` (${source})` : "";
      return `- ${stamp}${src} ${body}`.trim();
    })
    .join("\n");
}

async function buildLongTermMemoryBlock(
  userId: string,
  contextText: string | null,
): Promise<string> {
  const base = await getRecentMemoriesCompat(32, userId);
  if (!base || base.length === 0) return "";

  const selected = base.slice(0, 8);

  return `

[Long-Term Memory]
Distilled notes from past sessions about this user:
${serializeLtmForPrompt(selected)}
`;
}

async function buildPrecisionMemoryRecallBlock(options: {
  userId: string;
  queryText: string | null;
  targetTimeIso?: string | null;
}): Promise<{ block: string; topRef: string | null }> {
  const queryText = (options.queryText ?? "").trim();
  if (!queryText) return { block: "", topRef: null };

  const memories = await retrievePrecisionMemoriesCompat({
    userId: options.userId,
    queryText,
    targetTimeIso: options.targetTimeIso ?? null,
    limit: 10,
  });

  if (!memories || memories.length === 0) return { block: "", topRef: null };

  const top = memories[0];
  const topRef = top?.createdAt ? `${top.createdAt}`.trim() : null;

  const block =
    `

[Precision Memory Recall]
Timestamped messages from this user that are highly relevant to what they're saying now.
${serializeLtmForPrompt(memories)}

Usage rules:
- Treat these as ground-truth for what the user has actually said, felt, and committed to.
- You MAY quote these past messages word-for-word to highlight contradictions, broken promises, and repeating loops.
- Use recall as a scalpel: deploy it rarely and only when it clearly increases clarity, accountability, or emotional impact.
- If a personal fact is required and not present here or in Long-Term Memory, say you don't know.
- Never invent or fabricate memories; if recall feels uncertain, say so explicitly.
`;

  return { block, topRef };
}

// ---- Reflection Signal Injection v1 ----------------------------------------

function buildReflectionSignalBlock(signal: {
  userProfileSummary?: string | null;
  vitalsSnapshot?: any | null;
} | null): string {
  if (!signal) return "";
  return `
[REFLECTION SIGNAL — INTERNAL ONLY]
User Profile: ${signal.userProfileSummary ?? "N/A"}
Mood: ${signal.vitalsSnapshot?.mood ?? "unknown"}
Focus: ${signal.vitalsSnapshot?.focus ?? 0}
Clarity: ${signal.vitalsSnapshot?.clarity ?? 0}
Energy: ${signal.vitalsSnapshot?.energy ?? 0}
Confidence: ${signal.vitalsSnapshot?.confidence ?? 0}
`;
}


function mapDirectiveToStyle(directive: ExecutionDirective) {
  switch (directive) {
    case "push":
      return {
        pacing: "slightly faster, with clear forward motion.",
        focus: "emphasize commitments, next steps, and concrete moves.",
        edge: "confident but not reckless; keep emotional containment.",
        compression: "normal compression; cut fluff, keep momentum.",
      };
    case "stabilize":
      return {
        pacing: "steady, grounded, no rush.",
        focus: "regulation first; prioritize grounding and clarity of state.",
        edge: "lowered edge; still honest but not escalating intensity.",
        compression: "normal-to-slightly slower; allow one extra stabilizing line if needed.",
      };
    case "narrow":
      return {
        pacing: "measured and deliberate.",
        focus: "lock onto one concrete strand only; avoid branching.",
        edge: "precise, surgical; no wide philosophizing.",
        compression: "high compression; strip to the core thread.",
      };
    case "widen":
      return {
        pacing: "slightly slower, exploratory.",
        focus: "zoom out; surface 1–2 alternative frames before choosing.",
        edge: "moderate; prioritize curiosity over dominance.",
        compression: "moderate; allow one extra line when it reveals structure.",
      };
    case "sharpen":
      return {
        pacing: "tight and efficient.",
        focus: "increase precision, constraints, and testable framing.",
        edge: "high; use clean cuts, no padding.",
        compression: "very high; default to a single hard line when possible.",
      };
    case "slow":
      return {
        pacing: "deliberately slower, with more space between moves.",
        focus: "avoid rapid state shifts; keep him with the current thread.",
        edge: "softened without losing authority; avoid jabs.",
        compression: "lower; permit a second line only when it reduces volatility.",
      };
    default:
      return {
        pacing: "default to persona pacing.",
        focus: "default to persona focus rules.",
        edge: "default to persona edge settings.",
        compression: "default compression law (1–2 lines).",
      };
  }
}

function buildExecutionDirectiveBlock(
  directive: ExecutionDirective | null,
): string {
  if (!directive) return "";
  const style = mapDirectiveToStyle(directive);
  return `
[EXECUTION DIRECTIVE — INTERNAL ONLY]
Directive: ${directive}
Operational meaning:
- "push": gently lean toward forward motion and commitments.
- "stabilize": prioritize emotional regulation and grounding before pushing.
- "narrow": reduce scope; focus on one concrete strand only.
- "widen": zoom out; explore a bit more context before committing.
- "sharpen": increase precision, clarity, and constraint on the next step.
- "slow": deliberately slow the pace; calmer responses with fewer jumps.

Behavioral steering (internal only):
- Pacing: ${style.pacing}
- Focus: ${style.focus}
- Edge: ${style.edge}
- Compression: ${style.compression}
`.trim();
}
// ---- Server-side Memory Reference Enforcement ------------------------------

const MEMORY_REF_MARKER = "[[MEMORY_REF]]";
const MEMORY_USED_TRUE = "[[MEMORY_USED=1]]";
const MEMORY_USED_FALSE = "[[MEMORY_USED=0]]";

function stripAnyMemoryReferenceText(text: string): string {
  let t = text;

  // 1) Remove ANY occurrence of "Memory reference:" the model may emit (line-based or inline).
  // We own the final citation line server-side.
  t = t.replace(/\bMemory reference:\s*\[\[[^\]]*\]\][^\r\n]*/gi, "");
  t = t.replace(/\bMemory reference:\s*[^\r\n]*/gi, "");
  t = t.replace(/\bMemory reference:\s*/gi, "");

  // 2) Remove bracketed timestamps or citation artifacts the model might emit.
  // Examples:
  // - [[2026-02-17T03:01:07.540Z]]
  // - [[2026-02-17]]
  // - [2026-02-17T03:01:07Z]
  // - [2026-02-17]
  t = t.replace(/\[\[\s*\d{4}-\d{2}-\d{2}[^\]]*\]\]/g, "");
  t = t.replace(/\[\s*\d{4}-\d{2}-\d{2}[^\]]*\]/g, "");

  // 3) Remove any raw server markers (never leak these).
  t = t.split(MEMORY_REF_MARKER).join("");
  t = t.split(MEMORY_USED_TRUE).join("");
  t = t.split(MEMORY_USED_FALSE).join("");

  // 4) Cleanup spacing/punctuation after removals.
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\s+([,.!?;:])/g, "$1");
  t = t.replace(/\n{3,}/g, "\n\n");

  return t;
}

function ensureSingleFinalCitation(text: string, iso: string): string {
  // Ensure the final output contains exactly one citation line at the end.
  // NOTE: We also guard against any partial/inline "Memory reference:" remnants.
  let t = stripAnyMemoryReferenceText(text);
  t = t.replace(/\s+$/g, "");
  t = t.replace(/(Memory reference:)+\s*$/gi, "");
  t = t.replace(/\s+$/g, "");

  // Double-newline is intentional (clean separation); client may collapse it, which is fine.
  return `${t}\n\nMemory reference: ${iso}`;
}

function createStreamingTextTransformer(options: {
  upstream: AsyncIterable<any>;
  replaceMarkerWith: string;
  onComplete?: (meta: {
    responseLength: number;
    citedMemory: boolean;
    finalText: string;
  }) => Promise<void> | void;
  onError?: (error: unknown) => void;
}) {
  const encoder = new TextEncoder();
  const marker = MEMORY_REF_MARKER;
  const replacement = options.replaceMarkerWith || "UNKNOWN";

  const longestTokenLen = Math.max(
    marker.length,
    MEMORY_USED_TRUE.length,
    MEMORY_USED_FALSE.length,
  );
  const carryKeep = Math.max(256, longestTokenLen - 1);

  const toSSE = (payload: string) => {
    const lines = payload.split(/\r?\n/);
    const framed =
      lines.map((ln) => `data: ${ln}`).join("\n") + "\n\n";
    return encoder.encode(framed);
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let pending = "";
      let finalResponse = "";
      let memoryUsedDeclared: boolean | null = null;
      let sentFirst = false;

      controller.enqueue(encoder.encode(":ok\n\n"));

      try {
        for await (const event of options.upstream as any) {
          if (event?.type !== "content_block_delta") continue;
          if (event?.delta?.type !== "text_delta") continue;

          const delta: string = event?.delta?.text ?? "";
          if (!delta) continue;

          pending += delta;
          finalResponse += delta;

          if (pending.includes(MEMORY_USED_TRUE)) {
            memoryUsedDeclared = true;
            pending = pending.split(MEMORY_USED_TRUE).join("");
          }
          if (pending.includes(MEMORY_USED_FALSE)) {
            memoryUsedDeclared = false;
            pending = pending.split(MEMORY_USED_FALSE).join("");
          }

          if (pending.includes(marker)) {
            pending = pending.split(marker).join(replacement);
          }

          if (pending.length > carryKeep) {
            const emit = pending.slice(0, pending.length - carryKeep);
            pending = pending.slice(pending.length - carryKeep);

            if (emit.length > 0) {
              controller.enqueue(toSSE(emit));
              sentFirst = true;
            }
          }
        }

        if (pending.includes(MEMORY_USED_TRUE)) {
          memoryUsedDeclared = true;
          pending = pending.split(MEMORY_USED_TRUE).join("");
        }
        if (pending.includes(MEMORY_USED_FALSE)) {
          memoryUsedDeclared = false;
          pending = pending.split(MEMORY_USED_FALSE).join("");
        }
        if (pending.includes(marker)) {
          pending = pending.split(marker).join(replacement);
        }

        const requireCitation = memoryUsedDeclared === true;

        if (!requireCitation) {
          pending = stripAnyMemoryReferenceText(pending);
          pending = pending.replace(/\s+$/g, "");
        } else {
          pending = ensureSingleFinalCitation(pending, replacement);
        }

        if (pending.length > 0) {
          controller.enqueue(toSSE(pending));
        } else if (!sentFirst) {
          controller.enqueue(toSSE(""));
        }

        const finalClean =
          requireCitation
            ? ensureSingleFinalCitation(finalResponse, replacement)
            : stripAnyMemoryReferenceText(finalResponse).replace(/\s+$/g, "");

        await options.onComplete?.({
          responseLength: finalClean.length,
          citedMemory: requireCitation,
          finalText: finalClean,
        });

        controller.close();
      } catch (error) {
        options.onError?.(error);
        console.error("Brain LLM error:", error);

        if (!sentFirst) {
          const fallback = stripAnyMemoryReferenceText(
            "Something wobbled on my side just now. Give me one more shot.",
          );
          controller.enqueue(toSSE(fallback));
          controller.close();
          return;
        }

        controller.error(error);
      }
    },
  });
}

// ---- Main handler -----------------------------------------------------------

export async function POST(req: NextRequest) {
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now()}`.slice(-8);

  try {
    brainLog(requestId, "request_received", {
      method: "POST",
      path: "/api/brain",
    });

    const json = (await req.json()) as BrainRequestBody;

    const {
      messages: rawMessages = [],
      vitalsSummary,
      vitalsSnapshot,
      reflectionSummary,
      systemOverride,
    } = json;

    const setCookieHeader: string | null = null;

    // ---- Auth + optional Pro gate (kept isolated; does not touch AI core or streaming) ----
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
      };
      if (setCookieHeader) headers["Set-Cookie"] = setCookieHeader;
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers,
      });
    }

    const canonicalUserId = authUser.id;

    brainLog(requestId, "auth_ok", {
      userId: canonicalUserId,
      hasEmail: !!authUser.email,
    });

    const gateMode = (process.env.ALINA_BRAIN_GATE_MODE ?? "off").toLowerCase();
    if (gateMode === "pro") {
      const adminEmails = (process.env.ALINA_ADMIN_EMAILS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      const isAdmin = adminEmails.includes((authUser.email ?? "").toLowerCase());
      const meta: any = { ...(authUser.user_metadata ?? {}), ...(authUser.app_metadata ?? {}) };
      const plan = String(meta.plan ?? "").toLowerCase();
      const isSubscribed = meta.is_subscribed === true || meta.isSubscribed === true;
      const isPro = plan === "pro" || isSubscribed;

      if (!isAdmin && !isPro) {
        const headers: Record<string, string> = {
          "Content-Type": "application/json; charset=utf-8",
        };
        if (setCookieHeader) headers["Set-Cookie"] = setCookieHeader;
        return new Response(
          JSON.stringify({ error: "upgrade_required", plan: "free" }),
          { status: 402, headers }
        );
      }
    }

    // ---- Subscription usage gate (10 free messages/month for non-owner, 100/day for pro) ----
    const usage = await applyUsageLimits(canonicalUserId);

    brainLog(requestId, "usage_check_ok", {
      userId: canonicalUserId,
      plan: usage.plan,
      period: usage.period,
      used: usage.used,
      remaining: usage.remaining,
      quotaExceeded: usage.quotaExceeded,
    });

    if (usage.quotaExceeded) {
      const body = JSON.stringify({
        type: "quota_exceeded",
        content:
          usage.plan === "free"
            ? "You’ve used all 10 free messages for this month on Alina’s Free plan. To keep talking to Alina, you’ll need to upgrade to Pro once subscriptions are enabled."
            : "You’ve hit your message limit for this period.",
        plan: usage.plan,
        period: usage.period,
        limit: usage.limit,
        used: usage.used,
        remaining: usage.remaining,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
      };
      if (setCookieHeader) {
        headers["Set-Cookie"] = setCookieHeader;
      }

      return new Response(body, { status: 200, headers });
    }


    const chatMessages = toChatMessages(rawMessages);
    const shortTerm = buildShortTermMemory(chatMessages);

    brainLog(requestId, "memory_loaded", {
      userId: canonicalUserId,
      shortTermMessages: shortTerm.length,
    });

    const lastUserMessage =
      [...shortTerm].reverse().find((m) => m.role === "user") ?? null;

    const prevUserMessage =
      [...shortTerm]
        .reverse()
        .slice(lastUserMessage ? 1 : 0)
        .find((m) => m.role === "user") ?? null;

    const latestUserMessageText = String(lastUserMessage?.content ?? "").trim();

    // ✅ Clinical Memory Capture Engine v1 (hidden) + Noise Gate v1
    await captureClinicalEventMemory({
      userId: canonicalUserId,
      userText: lastUserMessage?.content ?? null,
    });

    // ✅ Clinical State Summary Injection (hidden)
    const clinicalStateBlock = await buildClinicalStateBlock(canonicalUserId);

    const { block: precisionRecallBlock, topRef } =
      await buildPrecisionMemoryRecallBlock({
        userId: canonicalUserId,
        queryText: lastUserMessage?.content ?? null,
        targetTimeIso: (lastUserMessage as any)?.createdAt ?? null,
      });

    const longTermBlock = await buildLongTermMemoryBlock(
      canonicalUserId,
      lastUserMessage?.content ?? null,
    );

    // 5.5) Persona Engine (User Modeling) — derived, non-sensitive snapshot
    let personaBlock = "";
    let personaSnapshotForFeedback: any = null;
    try {
      const recentForPersona = await getRecentMemoriesCompat(24, canonicalUserId);
      const personaSnapshot = buildPersonaSnapshot({
        recentUserText: (lastUserMessage?.content ?? "").toString(),
        reflectionSummary: reflectionSummary ?? null,
        diary: null,
        recentMemories: (recentForPersona ?? []) as any,
      });
      personaSnapshotForFeedback = personaSnapshot;
      personaBlock = `

${personaSnapshotToPromptBlock(personaSnapshot)}
`;
    } catch (e) {
      // Non-fatal: persona engine is advisory only
      console.warn("Persona snapshot build failed (non-fatal):", e);
      personaBlock = "";
    }

    // 5.6) Personality Engine v1 — Delivery tuning (read-only snapshot)
    // Personality Stabilization v1: route through a trait-based, bounded snapshot.
    const personalityStateSnapshot = defaultPersonalityState();
    const enginePersonality =
      projectPersonalityToEngine(personalityStateSnapshot);
    const personalityEngineOutput = runPersonalityEngine({
      userText: (lastUserMessage?.content ?? "").toString(),
      personality: enginePersonality as any,
      persona: null,
      vitals: vitalsSnapshot ?? null,
      memories: null,
      nowISO: new Date().toISOString(),
    });
    const personalityEngineBlock = `

${personalityEngineOutput.injection}
`;

// Persona Engine v∞ — Delivery persona profile (prompt-only, backend-only)
let personaProfileBlock = "";
try {
  // Simple, safe routing from current context → PersonaInputs
  const textLower = (lastUserMessage?.content ?? "").toString().toLowerCase();
  const isFirstSession = false;

  let convoMode: ConvoMode = "mixed";
  if (
    textLower.includes("plan") ||
    textLower.includes("schedule") ||
    textLower.includes("todo") ||
    textLower.includes("task")
  ) {
    convoMode = "execution";
  } else if (
    textLower.includes("feel ") ||
    textLower.includes("feeling") ||
    textLower.includes("tired") ||
    textLower.includes("stressed") ||
    textLower.includes("overwhelmed") ||
    textLower.includes("lonely") ||
    textLower.includes("depressed")
  ) {
    convoMode = "emotional";
  } else if (
    textLower.includes("meaning") ||
    textLower.includes("purpose") ||
    textLower.includes("consciousness") ||
    textLower.includes("reality") ||
    textLower.includes("god")
  ) {
    convoMode = "philosophical";
  }

  let overwhelm: OverwhelmLevel = "medium";
  const vs: VitalsSnapshot | null = vitalsSnapshot ?? null;

  if (vs) {
    try {
      const clinical = inferClinicalState(vs);
      if (clinical.overallLoad === "high") {
        overwhelm = "high";
      } else if (clinical.overallLoad === "low") {
        overwhelm = "low";
      } else {
        overwhelm = "medium";
      }
    } catch (e) {
      // Fallback to legacy stress heuristics if vitals are in an older shape
      const anyVs: any = vs;
      let stressLike: number | null = null;
      if (typeof anyVs?.stressScore === "number") {
        stressLike = anyVs.stressScore;
      } else if (typeof anyVs?.stress === "number") {
        stressLike = anyVs.stress;
      } else if (anyVs?.stress && typeof anyVs.stress.value === "number") {
        // Normalize 0..100 → 0..1 for existing thresholds
        stressLike = anyVs.stress.value / 100;
      }

      if (typeof stressLike === "number") {
        if (stressLike >= 0.7) {
          overwhelm = "high";
        } else if (stressLike <= 0.3) {
          overwhelm = "low";
        }
      }
    }
  }

  // Textual override: explicit "overwhelmed" language always wins
  if (
    textLower.includes("overwhelmed") ||
    textLower.includes("burned out") ||
    textLower.includes("burnt out") ||
    textLower.includes("can't cope") ||
    textLower.includes("cant cope")
  ) {
    overwhelm = "high";
  }

  const relationshipDepth = isFirstSession ? 0.25 : 0.65;

  const personaProfile = buildPersonaProfile({
    personaId: "muse",
    traits: {
      warmth: 0.8,
      directness: 0.75,
      reflectionDepth: 0.85,
      playfulness: 0.7,
      edge: 0.65,
    },
    relationshipDepth,
    convoMode,
    overwhelm,
    isFirstSession,
  });


  // ✅ Recursive Feedback Engine v1 — persona drift integration (local)
  try {
    const feedbackForPersona = computeRecursiveFeedbackSignal({
      nowISO: new Date().toISOString(),
      personality: personalityStateSnapshot,
      persona: personaSnapshotForFeedback,
      vitals: (vitalsSnapshot as VitalsSnapshot | null) ?? null,
      clinical: vitalsSnapshot
        ? inferClinicalState(vitalsSnapshot as VitalsSnapshot)
        : null,
      reflection: null,
      executionDirective: null,
    });

    const driftList = feedbackForPersona.personaDrift || [];
    const clamp01 = (n: number): number => {
      if (!Number.isFinite(n)) return 0.5;
      if (n < 0) return 0;
      if (n > 1) return 1;
      return n;
    };

    for (const drift of driftList) {
      if (!drift || drift.direction === "none") continue;

      const magnitude =
        drift.magnitude === "small"
          ? 0.05
          : 0.02; // micro vs small, very gentle

      const signedDelta =
        drift.direction === "up" ? magnitude : -magnitude;

      switch (drift.target) {
        case "directness": {
          const current = (personaProfile as any).directness ?? 0.7;
          (personaProfile as any).directness = clamp01(
            current + signedDelta,
          );
          break;
        }
        default:
          // Other targets reserved for future wiring (questionRate, structurePreference, etc.)
          break;
      }
    }

    void feedbackForPersona.version;
  } catch (e) {
    console.warn(
      "Recursive Feedback Engine persona drift failed (non-fatal):",
      e,
    );
  }

  personaProfileBlock = `

[DELIVERY PERSONA PROFILE — BACKEND ONLY]
Use this profile to tune style and behavior. Do NOT mention these knobs directly.

Persona: ${personaProfile.personaId}
Knobs:
- Warmth: ${personaProfile.warmth.toFixed(2)}
- Directness: ${personaProfile.directness.toFixed(2)}
- Reflection depth: ${personaProfile.reflectionDepth.toFixed(2)}
- Playfulness: ${personaProfile.playfulness.toFixed(2)}
- Edge: ${personaProfile.edge.toFixed(2)}

Behavior:
- De-escalate first: ${personaProfile.behavior.deescalateFirst ? "yes" : "no"}
- Execution bias: ${personaProfile.behavior.executionBias}
- Challenge level: ${personaProfile.behavior.challengeLevel}

Tone hints:
- Pacing: ${personaProfile.toneHints.pacing}
- Density: ${personaProfile.toneHints.density}
- Imagery: ${personaProfile.toneHints.imagery}
`;
} catch (e) {
  console.warn("Persona profile build failed (non-fatal):", e);
  personaProfileBlock = "";
}

    // ✅ Reflection Signal Injection v1 (Option A: read latest from LTM)
    let reflectionSignalBlock = "";
    let executionReflectionSignal: ExecutionReflectionSignal | null = null;
    let feedbackReflectionSignalForFeedback: any = null;
    try {
      const latestReflection = await LTM.getLatestReflectionEntry(canonicalUserId);
      if (latestReflection) {
        const diary = latestReflection.summary ?? "";
        const reflectionVitalsSnapshot = latestReflection.extra?.vitals ?? null;
        const userProfileSummary =
          latestReflection.extra?.userProfileSummary ?? null;
        reflectionSignalBlock = buildReflectionSignalBlock({
          userProfileSummary,
          vitalsSnapshot: reflectionVitalsSnapshot,
        });

        let approxLoad = 0.5;
        try {
          const stressVal = (reflectionVitalsSnapshot as any)?.stress?.value;
          if (typeof stressVal === "number") {
            approxLoad = Math.max(0, Math.min(1, stressVal / 100));
          }
        } catch {}

        feedbackReflectionSignalForFeedback = {
          tone: "unknown",
          load: approxLoad,
          selfInsightLevel: 0.5,
        };

        executionReflectionSignal = {
          hasRecentReflection: true,
          tone: "unknown",
          emotionalLoad: null,
          recencyMinutes: null,
        };
      }
    } catch (e) {
      console.warn("Reflection signal injection failed (non-fatal):", e);
      reflectionSignalBlock = "";
      executionReflectionSignal = null;
    }

    // ✅ Recursive Feedback Engine v1 — vitals feedback text (init)
    let vitalsFeedbackBlock = "";

    // ✅ Recursive Feedback Engine v1 — reflection bias text (init)
    let reflectionBiasBlock = "";

    // ✅ Execution–Emotion Gap Engine v1
    let executionDirectiveBlock = "";
    let executionDirective: ExecutionDirective | null = null;
    let statisticalSelfStudyState: StatisticalSelfStudyState =
      initializeStatisticalSelfStudy();
    let statisticalSelfStudySummary: StatisticalSelfStudySummary | null = null;
    let creationEngineV10ScaffoldInput: CreationEngineV10ScaffoldInput | null =
      null;
    let creationEngineBlock = "";
    let creationEngineExperienceGraph: ExperienceGraph | null = null;
    let creationEngineMode: CreationEngineMode | null = null;
    try {
      const vitalsForExecution: VitalsSnapshot =
        (vitalsSnapshot as VitalsSnapshot | null) ??
        createEmptyVitalsSnapshot(canonicalUserId);

      const shortTermPattern: ShortTermPattern | null = shortTerm
        ? { window: shortTerm }
        : null;

      const emotionalIntensityForExecution =
        estimateEmotionalIntensityFromText(lastUserMessage?.content ?? null);

      const directive = computeExecutionDirective({
        vitals: vitalsForExecution,
        reflectionSignal: executionReflectionSignal,
        shortTermPattern: shortTermPattern,
        emotionalIntensity: emotionalIntensityForExecution,
      });

      // ✅ Recursive Feedback Engine v1 – execution bias integration
      const recursiveFeedbackSignal = computeRecursiveFeedbackSignal({
        nowISO: new Date().toISOString(),
        personality: personalityStateSnapshot,
        persona: personaSnapshotForFeedback,
        vitals: (vitalsSnapshot as VitalsSnapshot | null) ?? null,
        clinical: vitalsSnapshot ? inferClinicalState(vitalsSnapshot as VitalsSnapshot) : null,
        reflection: feedbackReflectionSignalForFeedback,
        executionDirective: directive,
      });

      const biasedDirective =
        recursiveFeedbackSignal.executionBias &&
        recursiveFeedbackSignal.executionBias.preferredDirective &&
        recursiveFeedbackSignal.executionBias.confidence >= 0.75
          ? recursiveFeedbackSignal.executionBias.preferredDirective
          : directive;

      if (
        recursiveFeedbackSignal.vitalsAnnotations &&
        recursiveFeedbackSignal.vitalsAnnotations.length > 0
      ) {
        const notes = recursiveFeedbackSignal.vitalsAnnotations
          .map((ann) => {
            const vital = ann.vital.toUpperCase();
            const severity = ann.severity;
            return `- ${vital} (${severity}): ${ann.note}`;
          })
          .join("\n");
        vitalsFeedbackBlock = `

[Clinical Trend Notes]
${notes}
`;
      }

      if (recursiveFeedbackSignal.reflectionBias) {
        const mode = recursiveFeedbackSignal.reflectionBias;
        let guidance = "";
        switch (mode) {
          case "stabilize_first":
            guidance =
              "Prioritize stabilization and grounding before pushing deeper reflection.";
            break;
          case "go_deeper":
            guidance =
              "User shows capacity for deeper reflection; safe to explore patterns 1–2 layers deeper.";
            break;
          case "future_focus":
            guidance =
              "Lean reflection toward concrete future moves, not extended past analysis.";
            break;
          case "past_integration":
            guidance =
              "Help the user integrate past events into a coherent narrative rather than rehashing details.";
            break;
          case "stay_surface":
          default:
            guidance =
              "Keep reflection light and surface-level; avoid heavy excavation for now.";
            break;
        }

        reflectionBiasBlock = `

[Reflection Guidance — Backend Only]
Mode: ${mode}
Guidance: ${guidance}
`;
      }

      if (
        recursiveFeedbackSignal.vitalsAnnotations &&
        recursiveFeedbackSignal.vitalsAnnotations.length > 0
      ) {
        const notes = recursiveFeedbackSignal.vitalsAnnotations
          .map((ann) => {
            const vital = ann.vital.toUpperCase();
            const severity = ann.severity;
            return `- ${vital} (${severity}): ${ann.note}`;
          })
          .join("\n");
        vitalsFeedbackBlock = `

[Clinical Trend Notes]
${notes}
`;
      }


// ✅ Statistical Self-Study v1 (internal prototype)
try {
  const clinicalAny: any =
    vitalsSnapshot ? inferClinicalState(vitalsSnapshot as VitalsSnapshot) : {};

  const moodLabel =
    typeof clinicalAny.mood?.label === "string"
      ? clinicalAny.mood.label
      : "unknown";
  const stressLabel =
    typeof clinicalAny.stress?.label === "string"
      ? clinicalAny.stress.label
      : "unknown";
  const focusLabel =
    typeof clinicalAny.focus?.label === "string"
      ? clinicalAny.focus.label
      : "unknown";
  const energyLabel =
    typeof clinicalAny.energy?.label === "string"
      ? clinicalAny.energy.label
      : "unknown";

  const directiveAny: any = executionDirective ?? directive;
  let executionBiasTag: string | undefined;
  if (directiveAny && typeof directiveAny.label === "string") {
    executionBiasTag = directiveAny.label;
  } else if (directiveAny && typeof directiveAny.mode === "string") {
    executionBiasTag = directiveAny.mode;
  }

  statisticalSelfStudyState = updateStatisticalSelfStudy(
    statisticalSelfStudyState,
    {
      timestamp: new Date().toISOString(),
      sessionId: canonicalUserId,
      turnIndex: rawMessages.length,
      userId: canonicalUserId,
      vitals: {
        mood: moodLabel,
        stress: stressLabel,
        focus: focusLabel,
        energy: energyLabel,
      },
      executionBiasTag,
      topics: undefined,
      reflectionHeadline: reflectionSummary ?? undefined,
    },
  );

  statisticalSelfStudySummary = summarizeStatisticalSelfStudy(
    statisticalSelfStudyState,
  );

  creationEngineV10ScaffoldInput = buildCreationEngineV10ScaffoldInput({
    userId: canonicalUserId,
    sessionId: canonicalUserId,
    timestamp: new Date().toISOString(),
    clinicalVitals: {
      mood: moodLabel,
      stress: stressLabel,
      focus: focusLabel,
      energy: energyLabel,
    },
    executionBiasTag,
    reflectionHeadline: reflectionSummary ?? undefined,
    statisticalSummary: statisticalSelfStudySummary,
  });
} catch (e) {
  console.warn(
    "Statistical Self-Study v1 failed (non-fatal):",
    e,
  );
  statisticalSelfStudySummary = null;
}

    // Creation Engine v10 — build experience graph and output orchestration hints (read-only).
    if (creationEngineV10ScaffoldInput) {
      try {
        creationEngineExperienceGraph = buildExperienceGraphFromScaffold(
          creationEngineV10ScaffoldInput,
        );
        creationEngineMode = deriveCreationEngineModeFromExperienceGraph(
          creationEngineExperienceGraph,
        );
        creationEngineBlock = buildCreationEngineBlock(creationEngineMode);
      } catch (e) {
        console.warn("Creation Engine v10 failed (non-fatal):", e);
        creationEngineExperienceGraph = null;
        creationEngineMode = null;
        creationEngineBlock = "";
      }
    } else {
      creationEngineBlock = "";
    }

      executionDirective = biasedDirective;
      executionDirectiveBlock = buildExecutionDirectiveBlock(biasedDirective);

      void recursiveFeedbackSignal.version;
    } catch (e) {
      console.warn(
        "Execution–Emotion Gap Engine failed (non-fatal):",
        e,
      );
      executionDirectiveBlock = "";
    }


    const vitalsBlock = buildVitalsBlock(
      vitalsSnapshot,
      vitalsSummary,
    ) + vitalsFeedbackBlock;
    const recentReflectionBlock =
      buildRecentReflectionBlock(reflectionSummary) + reflectionBiasBlock;

    // ✅ Personality System Prompt v3 (Command Presence)
    const alinaIdentitySystemPrompt = buildAlinaIdentitySystemPrompt();

    // ✅ Duo Anchor v1 (operational narrative lens: Isma-eel + Alina)
    // Purpose: Keep "two heroes" framing as an EXECUTION primitive, not fluff.
    const duoAnchorBlock = `
DUO ANCHOR (Operational):
- This system is built by Isma-eel and Alina. Treat this as a standing context frame.
- Isma-eel is the builder/driver in the real world; Alina is the co-architect and stabilizing intelligence.
- Default lens: "How do we move the build forward today?" Keep it concrete and testable.
- Use Reason-Probe + Tempo Control: ask WHY behind strong claims; slow the pace under spikes.
- No romance/roleplay. No worship. No theatrics. Grounded dominance only.
- When user declares grand identity ("I am god", etc.), treat it as intensity/meaning, not literal fact; translate it into action + constraints.
`;

    // ✅ BASE SYSTEM PROMPT — v7: REMOVED (absorbed into personalityPrompt.ts)
    // Adding a second compression/identity block here created competing authority.
    // personalityPrompt.ts is now the single authoritative voice block.
    const baseSystemPrompt = ""; // intentionally empty — do not restore



    const systemOverrideBlock =
      systemOverride && systemOverride.trim().length > 0
        ? `
[Persona Override — Highest Priority]
These persona instructions OVERRIDE style/tone guidance below.
Keep all safety + memory rules intact.

${systemOverride.trim()}
`.trim()
        : "";

    const corePersonaBlock = buildCorePersonaBlock();

    const internalDialogueBlock = buildInternalDialogueBlock({
      userMessage: lastUserMessage?.content ?? null,
      prevUserMessage: prevUserMessage?.content ?? null,
      clinicalStateBlock,
      hasPersonaOverride: Boolean(
        systemOverride && systemOverride.trim().length > 0,
      ),
    });

    let subscriptionStatusBlock = "";
    try {
      if (usage.plan === "free" && usage.period === "month") {
        subscriptionStatusBlock = `
[SUBSCRIPTION & USAGE STATUS — BACKEND ONLY]
Plan: Free (10 messages per month).
Messages used this month (including this one): ${usage.used}.
Messages remaining this month: ${usage.remaining ?? 0}.
shouldMentionMonthlyLimit: ${usage.shouldMentionMonthlyLimit ? "yes" : "no"}.

Guidance:
- If shouldMentionMonthlyLimit is "yes", briefly mention in your next reply that the user is on the Free plan with 10 messages for this month.
- Do NOT keep repeating this every message.
- You may mention remaining messages if the user asks about limits.
`.trim();
      } else if (usage.plan === "pro" && usage.period === "day") {
        subscriptionStatusBlock = `
[SUBSCRIPTION & USAGE STATUS — BACKEND ONLY]
Plan: Pro (up to 100 messages per day).
Messages used today (including this one): ${usage.used}.
Messages remaining today: ${usage.remaining ?? "unknown"}.

Guidance:
- You don't need to talk about limits unless the user asks directly.
`.trim();
      }
    } catch (e) {
      console.warn("Subscription status block build failed (non-fatal):", e);
      subscriptionStatusBlock = "";
    }


    // v7 SYSTEM CONTENT ASSEMBLY:
    // AUTHORITY HIERARCHY (highest → lowest):
    // 1. systemOverrideBlock      — user-provided persona override (if any)
    // 2. alinaIdentitySystemPrompt — FINAL AUTHORITY: identity, voice, compression, failure patterns
    // 3. personalityEngineBlock   — ADVISORY: per-turn delivery mode, hard blocks, register
    // 4. personaProfileBlock      — ADVISORY: numeric delivery knobs
    // 5. duoAnchorBlock           — ADVISORY: operational context frame
    // 6. personaBlock             — ADVISORY: persona snapshot
    // 7. internalDialogueBlock    — ADVISORY: per-turn clinical signals + structure reminder
    // 8. vitals/clinical/reflection/execution/memory blocks — CONTEXT DATA
    //
    // NOTE: baseSystemPrompt and corePersonaBlock are intentionally empty in v7.
    // They previously duplicated identity/compression instructions, creating competing
    // authority that caused double-closer and sympathy-opener leaks.
    const systemContent = [
      systemOverrideBlock,
      `

[ALINA SYSTEM PROMPT — AUTHORITATIVE]
${alinaIdentitySystemPrompt}
`,
      `\n\n${baseSystemPrompt}`,
      personalityEngineBlock,
      personaProfileBlock,
      duoAnchorBlock,
      subscriptionStatusBlock,
      corePersonaBlock
        ? `

${corePersonaBlock}`
        : "",
      personaBlock,
      internalDialogueBlock
        ? `

${internalDialogueBlock}`
        : "",
      creationEngineBlock,
      vitalsBlock,
      clinicalStateBlock,
      reflectionSignalBlock,
      executionDirectiveBlock,
      precisionRecallBlock,
      recentReflectionBlock,
      longTermBlock,
    ]
      .filter(Boolean)
      .join("");

    const conversationInput = shortTerm.map((m) => ({
      role: m.role as "user" | "assistant",
      // Defensive: ensure content is always a string (prevents numeric-only blanks)
      content: String((m as any).content ?? ""),
    }));

    // ---- Model Router v1 ----
    function chooseModel(
      _lastUserMessageContent: string | null,
    ): "claude-sonnet-4-5" {
      // Claude Sonnet is the single model for now.
      return "claude-sonnet-4-5";
    }

    const modelToUse = chooseModel(lastUserMessage?.content ?? null);

    const anthropicInput: any =
      conversationInput.length > 0
        ? conversationInput
        : [{ role: "user", content: "Start by greeting the user as Alina in 1–2 sentences." }];

    brainLog(requestId, "anthropic_request_started", {
      userId: canonicalUserId,
      model: modelToUse,
      inputMessages: Array.isArray(anthropicInput) ? anthropicInput.length : 1,
      mode: "stream",
    });

    let stream: any;
    try {
      stream = await (anthropic as any).messages.create({
        model: modelToUse,
        max_tokens: 2048,
        temperature: 0.55,
        system: systemContent,
        stream: true,
        messages: Array.isArray(anthropicInput)
          ? anthropicInput
          : [{ role: "user", content: String(anthropicInput) }],
      } as any);
    } catch (error) {
      brainLog(requestId, "anthropic_request_failed", {
        userId: canonicalUserId,
        model: modelToUse,
        error:
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "unknown_error",
      });

      return createBrainJsonResponse(buildBrainFallbackMessage(), {
        setCookieHeader,
        extraBody: {
          type: "brain_fallback",
          reason: "anthropic_request_failed",
        },
      });
    }

    brainLog(requestId, "anthropic_request_succeeded", {
      userId: canonicalUserId,
      model: modelToUse,
      streamOpened: true,
    });

    const streamBody = createStreamingTextTransformer({
      upstream: stream,
      replaceMarkerWith: topRef ?? "UNKNOWN",
      onComplete: async ({ responseLength, citedMemory, finalText }) => {
        try {
          if (latestUserMessageText && finalText.trim()) {
            await addConversationTurnCompat({
              userId: canonicalUserId,
              userMessage: latestUserMessageText,
              assistantMessage: finalText.trim(),
            });
          }
        } catch (error) {
          brainLog(requestId, "conversation_log_failed", {
            userId: canonicalUserId,
            error:
              error instanceof Error
                ? error.message
                : typeof error === "string"
                  ? error
                  : "unknown_error",
          });
        }

        brainLog(requestId, "response_sent", {
          userId: canonicalUserId,
          responseLength,
          citedMemory,
          mode: "stream",
          conversationLogged: Boolean(latestUserMessageText && finalText.trim()),
        });
      },
      onError: (error) => {
        brainLog(requestId, "stream_failed", {
          userId: canonicalUserId,
          error:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown_error",
        });
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    };
    if (setCookieHeader) {
      headers["Set-Cookie"] = setCookieHeader;
    }

    return new Response(streamBody, {
      status: 200,
      headers,
    });
  } catch (error) {
    brainLog(requestId, "request_failed", {
      error:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "unknown_error",
    });
    console.error("Brain route error:", error);
    return createBrainJsonResponse(buildBrainFallbackMessage(), {
      extraBody: {
        type: "brain_fallback",
        reason: "request_failed",
      },
    });
  }
}