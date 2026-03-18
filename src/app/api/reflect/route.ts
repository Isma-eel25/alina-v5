// src/app/api/reflect/route.ts
// 🪞 Alina Reflection API – Reflection Engine v1 (Claude Sonnet 4.5)
// Generates internal diary + stable user profile card + vitals snapshot
// Stores reflection in LTM + emits distilled reflectionSignal for system prompt injection
// NEVER leaks raw internal thinking to the user.

import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildShortTermMemory, toChatMessages } from "@/lib/memory";
import { addMemoryFromReflection } from "@/lib/longTermMemory";
import type { VitalsSnapshot } from "@/lib/vitals";
import {
  defaultPersonalityState,
  mutateTrait,
  type PersonalityState,
} from "@/lib/personalityState";
import { upsertPersonalityStateSnapshot } from "@/lib/selfState";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

type ChatRole = "user" | "assistant";

interface IncomingMessage {
  role: ChatRole;
  content: string;
  createdAt?: string;
}

interface ReflectRequestBody {
  messages?: unknown;
  vitalsSummary?: string | null;
  userId?: string | null;
}

type ReflectionModelJson = {
  diary: string;
  userProfileSummary: string;
  vitalsSnapshot: {
    mood: "very_low" | "low" | "neutral" | "good" | "high";
    focus: number;
    clarity: number;
    energy: number;
    confidence: number;
  };
};

function isoNow(): string {
  return new Date().toISOString();
}

function safeMessages(raw: unknown): IncomingMessage[] {
  if (!Array.isArray(raw)) return [];
  const toRole = (r: unknown): ChatRole => (r === "user" ? "user" : "assistant");
  return raw
    .map((m: any): IncomingMessage => ({
      role: toRole(m?.role),
      content: typeof m?.content === "string" ? m.content : "",
      createdAt:
        typeof m?.createdAt === "string" && m.createdAt.trim().length > 0
          ? m.createdAt
          : undefined,
    }))
    .filter((m) => m.content.trim().length > 0);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

let currentPersonalityState: PersonalityState | null = null;

function getOrInitPersonalityState(): PersonalityState {
  if (!currentPersonalityState) {
    currentPersonalityState = defaultPersonalityState();
  }
  return currentPersonalityState;
}

function applyReflectionPersonalityMutation(
  state: PersonalityState,
  diary: string,
  vitals: VitalsSnapshot
): PersonalityState {
  let next = state;
  const mood = (vitals as any)?.mood ?? "neutral";

  if (mood === "very_low" || mood === "low") {
    next = mutateTrait(next, {
      trait: "warmth",
      requestedDelta: 0.02,
      reason: "reflection_low_mood_support",
      signals: { mood, source: "reflect_v1" },
    });
    next = mutateTrait(next, {
      trait: "challenge",
      requestedDelta: -0.02,
      reason: "reflection_low_mood_reduce_pressure",
      signals: { mood, source: "reflect_v1" },
    });
  } else if (mood === "good" || mood === "high") {
    next = mutateTrait(next, {
      trait: "directness",
      requestedDelta: 0.02,
      reason: "reflection_high_mood_push_execution",
      signals: { mood, source: "reflect_v1" },
    });
  }

  return next;
}

function coerceVitalsSnapshot(v: any): VitalsSnapshot {
  const mood = ["very_low", "low", "neutral", "good", "high"].includes(v?.mood)
    ? v.mood
    : "neutral";
  return {
    ...(v ?? {}),
    mood,
    focus: clamp01(typeof v?.focus === "number" ? v.focus : 0.6),
    clarity: clamp01(typeof v?.clarity === "number" ? v.clarity : 0.6),
    energy: clamp01(typeof v?.energy === "number" ? v.energy : 0.6),
    confidence: clamp01(typeof v?.confidence === "number" ? v.confidence : 0.6),
  } as VitalsSnapshot;
}

function buildReflectionPrompt(
  shortTerm: ReturnType<typeof buildShortTermMemory>,
  vitalsSummary?: string | null
): string {
  return `
You are Alina's INTERNAL reflection engine.

Return STRICT JSON ONLY. No prose. No markdown. No extra fields.
Use EXACTLY these field names — do not invent new ones:

{
  "diary": "<2-4 sentence internal reflection>",
  "userProfileSummary": "<1-3 line compressed user profile>",
  "vitalsSnapshot": {
    "mood": "<one of: very_low | low | neutral | good | high>",
    "energy": <0.0 to 1.0>,
    "focus": <0.0 to 1.0>,
    "clarity": <0.0 to 1.0>,
    "confidence": <0.0 to 1.0>
  }
}

Conversation:
${shortTerm.map((m) => `[${m.role}] ${m.content}`).join("\n")}

Previous vitals:
${vitalsSummary ?? "None"}
`.trim();
}

function extractClaudeText(resp: any): string {
  const blocks = resp?.content ?? [];
  let text = "";
  for (const block of blocks) {
    if (block.type === "text") text += block.text;
  }
  return text.trim();
}

function coerceUserProfileSummary(x: unknown): string {
  const s = typeof x === "string" ? x.trim() : "";
  if (!s) return "Profile forming: insufficient signal.";
  return s.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join("\n");
}

// ------------------------------------------------------------
// Main Handler
// ------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    // ── AUTH: Supabase session — same identity source as brain route ──
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !authUser) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // This is now always the Supabase user ID — never a cookie, never a body param.
    const userId = authUser.id;
    // ─────────────────────────────────────────────────────────────────

    const json = (await req.json()) as ReflectRequestBody;

    const incoming = safeMessages(json.messages);
    const chatMessages = toChatMessages(incoming);
    const shortTerm = buildShortTermMemory(chatMessages);

    if (shortTerm.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid messages provided." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = buildReflectionPrompt(shortTerm, json.vitalsSummary ?? null);

    let resp: any;
    {
      const maxAttempts = 3;
      let lastErr: any;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          resp = await client.messages.create({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 800,
            system: "Return STRICT JSON ONLY.",
            messages: [{ role: "user", content: prompt }],
          });
          break;
        } catch (err: any) {
          lastErr = err;
          const status = err?.status ?? err?.statusCode ?? 0;
          if (
            (status === 529 || status === 503 || status === 429 || status === 500) &&
            attempt < maxAttempts
          ) {
            const delay = 1500 * attempt;
            console.warn(`Reflect API error ${status} (attempt ${attempt}), retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            throw err;
          }
        }
      }
      if (!resp) throw lastErr;
    }

    const raw = extractClaudeText(resp);

    let parsed: Partial<ReflectionModelJson> = {};
    try {
      let cleaned = raw.trim();
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```+\s*$/i, "")
        .trim();

      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      parsed = JSON.parse(cleaned);
    } catch (err) {
      const createdAt = isoNow();
      const vitalsSnapshot = coerceVitalsSnapshot(null);

      return new Response(
        JSON.stringify({
          diary: "",
          userProfileSummary: "Profile forming: insufficient signal.",
          vitalsSnapshot,
          reflectionSignal: null,
          createdAt,
          personalityState: null,
          degraded: true,
          degradedReason: "Invalid reflection JSON",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const diary = typeof parsed.diary === "string" ? parsed.diary.trim() : "";
    const userProfileSummary = coerceUserProfileSummary(parsed.userProfileSummary);
    const vitalsSnapshot = coerceVitalsSnapshot(parsed.vitalsSnapshot);

    const reflectionSignal = {
      userProfileSummary,
      mood: (vitalsSnapshot as any).mood,
      focus: (vitalsSnapshot as any).focus,
      clarity: (vitalsSnapshot as any).clarity,
      energy: (vitalsSnapshot as any).energy,
      confidence: (vitalsSnapshot as any).confidence,
    };

    const createdAt = isoNow();

    // Store in LTM — always keyed to authenticated Supabase user ID
    await addMemoryFromReflection({
      userId,
      diary,
      vitals: vitalsSnapshot,
      createdAt,
    } as any);

    let personalityState: PersonalityState | null = null;
    try {
      const current = getOrInitPersonalityState();
      const mutated = applyReflectionPersonalityMutation(current, diary, vitalsSnapshot);
      currentPersonalityState = mutated;
      personalityState = mutated;
      await upsertPersonalityStateSnapshot(userId, mutated);
    } catch (err) {
      console.warn("Personality mutation failed:", err);
    }

    return new Response(
      JSON.stringify({
        diary,
        userProfileSummary,
        vitalsSnapshot,
        reflectionSignal,
        createdAt,
        personalityState,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    const status = error?.status ?? error?.statusCode ?? 0;
    console.warn("Reflect route degraded (non-fatal):", status, error?.message ?? error);
    return new Response(
      JSON.stringify({
        diary: "",
        userProfileSummary: "",
        vitalsSnapshot: { mood: "neutral", focus: 0.6, clarity: 0.6, energy: 0.6, confidence: 0.6 },
        reflectionSignal: null,
        createdAt: new Date().toISOString(),
        personalityState: null,
        degraded: true,
        degradedReason: `API error ${status}`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
