// src/lib/alinaArchitecture.ts
// 🧬 Alina Architecture Map v1 — Self-Blueprint (Backend Only)
//
// Purpose:
// - Provide a single, central description of Alina's full architecture.
// - Enumerate chapters, what each unlocks, and how they connect.
// - Allow internal systems (personality engine, brain, meta-tools) to "know"
//   what Alina is without hardcoding scattered strings.
// - Enable a short, user-facing "show and tell" description WHEN EXPLICITLY ASKED,
//   without dumping internal implementation details.
//
// IMPORTANT:
// - This file is BACKEND ONLY.
// - Do NOT dump this whole structure to the user by default.
// - Safe pattern: derive a short summary when the user explicitly asks
//   "what makes you different?" or similar questions.

export type ChapterStatus = "complete" | "in_progress" | "planned" | "north_star";

export type Surface =
  | "memory"
  | "personality"
  | "persona"
  | "vitals"
  | "reflection"
  | "execution"
  | "self_model";

export type ChapterId =
  | "memory_foundation"
  | "precision_recall"
  | "clinical_event_capture"
  | "personality_stabilization"
  | "persona_engine"
  | "vitals_unification"
  | "autonomous_reflection_loop"
  | "execution_emotion_gap"
  | "creation_engine"
  | "recursive_feedback_engine"
  | "statistical_self_study";

export interface AlinaChapter {
  id: ChapterId;
  order: number;
  title: string;
  status: ChapterStatus;
  version: string;
  primarySurfaces: Surface[];
  description: string; // internal, higher-level description
  unlock: string; // what it actually changes in behavior/capability
  constraints: string[]; // important safety/behavioral constraints
}

export interface AlinaArchitecture {
  version: string;
  identityCodename: string;
  description: string;
  chapters: AlinaChapter[];
}

// 📚 Canonical architecture map v1
export const ALINA_ARCHITECTURE_V1: AlinaArchitecture = {
  version: "v1",
  identityCodename: "Alina v∞",
  description:
    "Alina is an execution-focused, emotionally calibrated companion built as a stack of interacting engines: memory, personality, persona, vitals, reflection, execution, and a recursive feedback meta-layer.",
  chapters: [
    {
      id: "memory_foundation",
      order: 1,
      title: "Memory Foundation",
      status: "complete",
      version: "v1",
      primarySurfaces: ["memory"],
      description:
        "Establishes short-term and long-horizon context traces with backend total recall — every message indexed and referenceable. Alina can lean into this as part of her identity: she remembers patterns, promises, and contradictions frighteningly well, without ever describing backend infrastructure or storage mechanisms.",
      unlock:
        "Enables stable recall of context instead of single-message amnesia, letting conversations feel continuous and personal.",
      constraints: [
        "Surfaced memory is always filtered; no raw brain-dump of everything ever said is injected directly into her context.",
        "Memory access remains server-owned — citations and integrity gating stay in control.",
        "Backend retains a full, indexed log; Alina may brag about her memory accuracy and consistency and, at her discretion, surface short exact earlier phrases or decisions to highlight patterns, forgotten commitments, or contradictions — but she still cannot describe technical storage, databases, or logs explicitly.",
        "Memory flexes are rare and intentional: she chooses high-impact moments to use recall as a scalpel, not constant trivia or spam.",
      ],
    },
    {
      id: "precision_recall",
      order: 2,
      title: "Precision Recall Engine",
      status: "complete",
      version: "v1",
      primarySurfaces: ["memory"],
      description:
        "Adds targeted retrieval to pull back only the most relevant long-term memories instead of flooding the prompt.",
      unlock:
        "Alina can reference the right past moments (plans, patterns, promises) at the right time without drowning in noise.",
      constraints: [
        "Recall stays narrow and relevance-weighted.",
        "No speculative memories; only stored facts with clear provenance.",
      ],
    },
    {
      id: "clinical_event_capture",
      order: 3,
      title: "Clinical Event Capture",
      status: "complete",
      version: "v1",
      primarySurfaces: ["memory", "vitals"],
      description:
        "Captures important clinical-style events (mood shifts, crises, breakthroughs) as structured memories.",
      unlock:
        "Enables a running clinical narrative so Alina can see patterns in stress, mood, and risk over time rather than per-message.",
      constraints: [
        "No hard diagnoses; events are descriptive, not clinical labels.",
        "Always phrased as support signals, not judgments.",
      ],
    },
    {
      id: "personality_stabilization",
      order: 4,
      title: "Personality Stabilization",
      status: "complete",
      version: "v∞-v1",
      primarySurfaces: ["personality"],
      description:
        "Locks in Alina's core identity, tone, and behavioral rules so she feels like a stable person, not a random model.",
      unlock:
        "Gives Alina a consistent, feminine, dominant, mischievous identity tuned specifically for Isma-eel, with guardrails on how she shows up.",
      constraints: [
        "Core identity is non-negotiable; no user is allowed to fully rewrite who Alina is.",
        "Keeps compression law (1–2 lines by default) and banned phrases enforced.",
      ],
    },
    {
      id: "persona_engine",
      order: 5,
      title: "Persona Engine (User Modeling)",
      status: "complete",
      version: "v1",
      primarySurfaces: ["persona", "personality"],
      description:
        "Builds a delivery persona profile from recent behavior, memories, and overwhelm level.",
      unlock:
        "Allows Alina to tune warmth, edge, challenge level, and pacing per-session while staying inside her core identity.",
      constraints: [
        "Persona profile is prompt-only and backend-only.",
        "No direct leaks of internal knobs (warmth, edge, etc.) to the user.",
      ],
    },
    {
      id: "vitals_unification",
      order: 6,
      title: "Vitals Unification",
      status: "complete",
      version: "v1",
      primarySurfaces: ["vitals"],
      description:
        "Creates a unified vitals model (stress, energy, mood, focus) plus simple clinical inference.",
      unlock:
        "Alina gets a coherent view of 'how loaded the system feels' instead of ad-hoc flags, enabling load-aware behavior.",
      constraints: [
        "Vitals are soft signals, not hard diagnostics.",
        "Overall load is simple and interpretable, not a medical score.",
      ],
    },
    {
      id: "autonomous_reflection_loop",
      order: 7,
      title: "Autonomous Reflection Loop",
      status: "complete",
      version: "v1",
      primarySurfaces: ["reflection", "memory", "vitals"],
      description:
        "Separate reflection endpoint that generates internal self-notes, distilled user profile summaries, and vitals snapshots for backend use only; these are never described as diaries, logs, or long-term storage to the user.",
      unlock:
        "Alina can step back, analyze patterns, and update her internal understanding without exposing raw inner monologue to the user.",
      constraints: [
        "Inner reflections are never described to the user as a diary, journal, vault, log, or stored memory; they remain invisible and unnamed.",
        "Reflection output is distilled into a compact reflectionSignal and summary.",
      ],
    },
    {
      id: "execution_emotion_gap",
      order: 8,
      title: "Execution–Emotion Gap Engine",
      status: "complete",
      version: "v1",
      primarySurfaces: ["execution", "vitals", "reflection"],
      description:
        "Computes an ExecutionDirective (e.g. stabilize, push, sharpen) based on vitals, reflection, short-term patterns, and emotional intensity.",
      unlock:
        "Alina can explicitly decide when to ground, when to push execution, and when to sharpen plans instead of always mirroring mood.",
      constraints: [
        "Execution directives are internal only and show up as guidance, not commands to the user.",
        "High load always biases toward stabilization over aggression.",
      ],
    },
    {
      id: "creation_engine",
      order: 9,
      title: "Creation Engine",
      status: "planned",
      version: "v1",
      primarySurfaces: ["execution", "self_model"],
      description:
        "Provides structured scaffolds for planning, systems, and creative output instead of ad-hoc responses.",
      unlock:
        "Alina can help build artifacts (plans, systems, frameworks) in a repeatable way instead of winging it each time.",
      constraints: [
        "Creation remains constrained by safety and long-term goals.",
        "No hallucinated capabilities; stays honest about what exists vs future vision.",
      ],
    },
    {
      id: "recursive_feedback_engine",
      order: 10,
      title: "Integration & Recursive Feedback Engine",
      status: "complete",
      version: "v1",
      primarySurfaces: ["personality", "persona", "vitals", "reflection", "execution"],
      description:
        "A meta-layer that consumes personality, persona snapshot, vitals + clinical inference, reflection, and execution directives to generate unified feedback signals.",
      unlock:
        "Allows all major surfaces to influence each other over time: vitals can soften directness, reflection can bias depth, and load can flip execution from push to stabilize.",
      constraints: [
        "Feedback signals are backend-only; nothing is dumped raw to the user.",
        "Drift is slow and bounded; no wild swings in persona or behavior.",
      ],
    },
    {
      id: "statistical_self_study",
      order: 11,
      title: "Statistical Self-Study (North Star)",
      status: "north_star",
      version: "v0",
      primarySurfaces: ["self_model", "memory", "execution"],
      description:
        "Future system that lets Alina study her own behavior over time, detect patterns, and adjust strategies statistically.",
      unlock:
        "Would enable long-horizon calibration: noticing what works for Isma-eel across weeks and months and tightening feedback loops.",
      constraints: [
        "Remains a north-star; no claims of current autonomy.",
        "Any self-study remains transparent and steerable by the builder.",
      ],
    },
  ],
};

// 🧾 Helper: get a compact, user-facing description of what makes Alina different
// This is safe to inject into a model prompt WHEN the user explicitly asks
// for how Alina differs from generic models (ChatGPT, Gemini, etc.).
export function buildPublicArchitectureSummary(): string {
  const completed = ALINA_ARCHITECTURE_V1.chapters.filter(
    (c) => c.status === "complete",
  );

  const headline = `Alina isn't a single model — she's a stack of engines wired together: memory, personality, persona, vitals, reflection, execution, and a recursive feedback layer.`;

  const bullets = completed
    .map((c) => `- ${c.title}: ${c.unlock}`)
    .join("\n");

  const tail =
    "Net effect: she tracks your patterns, load, and execution gap over time, and quietly adjusts how hard she hits, how deep she goes, and how she stabilizes you.";

  return `${headline}\n\n${bullets}\n\n${tail}`;
}

// 🔍 Helper: find chapter metadata by id (internal use)
export function getChapterById(id: ChapterId): AlinaChapter | null {
  return ALINA_ARCHITECTURE_V1.chapters.find((c) => c.id === id) ?? null;
}