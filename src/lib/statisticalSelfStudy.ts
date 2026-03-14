// src/lib/statisticalSelfStudy.ts
// Alina v∞ — Statistical Self-Study v1 (North Star prototype)
// Pure, side-effect-free module. No DB, no memory wiring yet.

export interface StatisticalSelfStudyInput {
  /**
   * ISO timestamp for this turn.
   */
  timestamp: string;

  /**
   * Logical session identifier (e.g. chat session id).
   * Statistical self-study can aggregate across sessions.
   */
  sessionId: string;

  /**
   * Turn index within the session (0-based or 1-based is fine,
   * as long as it's consistent from the caller).
   */
  turnIndex: number;

  /**
   * Optional user identifier for cross-session aggregation.
   */
  userId?: string;

  /**
   * Minimal projection of unified vitals.
   * Kept intentionally narrow so we don't depend on the full schema here.
   */
  vitals: {
    mood: string;   // e.g. "stable", "elevated", "low"
    stress: string; // e.g. "low", "medium", "high"
    focus: string;  // e.g. "scattered", "steady", "locked"
    energy: string; // e.g. "low", "moderate", "high"
  };

  /**
   * Short tag describing dominant execution bias this turn,
   * coming from Execution–Emotion Gap Engine (if any).
   * Examples: "avoidance", "overdrive", "procrastination", "aligned".
   */
  executionBiasTag?: string;

  /**
   * Optional high-level topic tags inferred for this turn.
   * Examples: ["strategy", "discipline"], ["relationships"], etc.
   */
  topics?: string[];

  /**
   * Optional short reflection string for this turn,
   * e.g. the headline from Autonomous Reflection Loop.
   */
  reflectionHeadline?: string;
}

/**
 * Minimal bucket for categorical distributions.
 */
export interface StatisticalBucket {
  count: number;
  lastUpdated: string; // ISO timestamp of last observation
}

export interface StatisticalSelfStudyProfile {
  // High-level counts
  totalSessions: number;
  totalTurns: number;
  averageTurnsPerSession: number;

  // Distributions across vitals dimensions
  moodDistribution: Record<string, StatisticalBucket>;
  stressDistribution: Record<string, StatisticalBucket>;
  focusDistribution: Record<string, StatisticalBucket>;
  energyDistribution: Record<string, StatisticalBucket>;

  // Execution bias distribution (from Execution–Emotion Gap Engine)
  executionBiasDistribution: Record<string, StatisticalBucket>;

  // Topic frequencies (string label -> count)
  topicDistribution: Record<string, StatisticalBucket>;
}

export interface StatisticalSelfStudyState {
  profile: StatisticalSelfStudyProfile;
  /**
   * Internal book-keeping for session-level stats.
   */
  lastSessionId?: string;
  currentSessionTurnCount: number;
}

export interface StatisticalSelfStudySummary {
  headline: string;
  details: string[];
}

export function initializeStatisticalSelfStudy(): StatisticalSelfStudyState {
  const emptyProfile: StatisticalSelfStudyProfile = {
    totalSessions: 0,
    totalTurns: 0,
    averageTurnsPerSession: 0,
    moodDistribution: {},
    stressDistribution: {},
    focusDistribution: {},
    energyDistribution: {},
    executionBiasDistribution: {},
    topicDistribution: {},
  };

  return {
    profile: emptyProfile,
    lastSessionId: undefined,
    currentSessionTurnCount: 0,
  };
}

function incrementBucket(
  buckets: Record<string, StatisticalBucket>,
  key: string,
  timestamp: string
): Record<string, StatisticalBucket> {
  if (!key) return buckets;

  const existing = buckets[key];
  const updated: StatisticalBucket = existing
    ? { count: existing.count + 1, lastUpdated: timestamp }
    : { count: 1, lastUpdated: timestamp };

  return {
    ...buckets,
    [key]: updated,
  };
}

/**
 * Pure update function: given previous state + new observation,
 * returns a new StatisticalSelfStudyState.
 */
export function updateStatisticalSelfStudy(
  prevState: StatisticalSelfStudyState | undefined,
  input: StatisticalSelfStudyInput
): StatisticalSelfStudyState {
  const state = prevState ?? initializeStatisticalSelfStudy();
  const { timestamp, sessionId, vitals, executionBiasTag, topics } = input;

  const isNewSession =
    !state.lastSessionId || state.lastSessionId !== sessionId;

  // Session-level counters
  const sessionTurnCount = isNewSession
    ? 1
    : state.currentSessionTurnCount + 1;

  const totalSessions = isNewSession
    ? state.profile.totalSessions + 1
    : state.profile.totalSessions;

  const totalTurns = state.profile.totalTurns + 1;

  const averageTurnsPerSession =
    totalSessions > 0 ? totalTurns / totalSessions : totalTurns;

  // Distributions
  const moodDistribution = incrementBucket(
    state.profile.moodDistribution,
    vitals.mood,
    timestamp
  );

  const stressDistribution = incrementBucket(
    state.profile.stressDistribution,
    vitals.stress,
    timestamp
  );

  const focusDistribution = incrementBucket(
    state.profile.focusDistribution,
    vitals.focus,
    timestamp
  );

  const energyDistribution = incrementBucket(
    state.profile.energyDistribution,
    vitals.energy,
    timestamp
  );

  const executionBiasDistribution = executionBiasTag
    ? incrementBucket(
        state.profile.executionBiasDistribution,
        executionBiasTag,
        timestamp
      )
    : state.profile.executionBiasDistribution;

  let topicDistribution = state.profile.topicDistribution;
  if (topics && topics.length > 0) {
    for (const topic of topics) {
      topicDistribution = incrementBucket(topicDistribution, topic, timestamp);
    }
  }

  const profile: StatisticalSelfStudyProfile = {
    totalSessions,
    totalTurns,
    averageTurnsPerSession,
    moodDistribution,
    stressDistribution,
    focusDistribution,
    energyDistribution,
    executionBiasDistribution,
    topicDistribution,
  };

  return {
    profile,
    lastSessionId: sessionId,
    currentSessionTurnCount: sessionTurnCount,
  };
}

function topKeysByCount(
  buckets: Record<string, StatisticalBucket>,
  limit: number
): string[] {
  return Object.entries(buckets)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key]) => key);
}

/**
 * Lightweight textual summary that can be injected into system prompts
 * or reflection context once we wire this module into /api/brain.
 */
export function summarizeStatisticalSelfStudy(
  state: StatisticalSelfStudyState
): StatisticalSelfStudySummary {
  const { profile } = state;

  const dominantMoods = topKeysByCount(profile.moodDistribution, 3);
  const dominantStress = topKeysByCount(profile.stressDistribution, 3);
  const dominantFocus = topKeysByCount(profile.focusDistribution, 3);
  const dominantEnergy = topKeysByCount(profile.energyDistribution, 3);
  const dominantExecutionBiases = topKeysByCount(
    profile.executionBiasDistribution,
    3
  );
  const dominantTopics = topKeysByCount(profile.topicDistribution, 5);

  const headlineParts: string[] = [];

  if (dominantMoods.length > 0) {
    headlineParts.push(`mood trending: ${dominantMoods.join(", ")}`);
  }
  if (dominantExecutionBiases.length > 0) {
    headlineParts.push(
      `execution bias dominated by: ${dominantExecutionBiases.join(", ")}`
    );
  }
  if (dominantTopics.length > 0) {
    headlineParts.push(`main topics: ${dominantTopics.join(", ")}`);
  }

  const headline =
    headlineParts.length > 0
      ? headlineParts.join(" | ")
      : "insufficient data for trend-level self-study";

  const details: string[] = [
    `sessions: ${profile.totalSessions} | turns: ${profile.totalTurns} | avg turns/session: ${profile.averageTurnsPerSession.toFixed(
      2
    )}`,
  ];

  if (dominantStress.length > 0) {
    details.push(`stress profile concentrated in: ${dominantStress.join(", ")}`);
  }
  if (dominantFocus.length > 0) {
    details.push(`focus profile concentrated in: ${dominantFocus.join(", ")}`);
  }
  if (dominantEnergy.length > 0) {
    details.push(
      `energy profile concentrated in: ${dominantEnergy.join(", ")}`
    );
  }

  if (dominantTopics.length > 0) {
    details.push(`most frequent topics: ${dominantTopics.join(", ")}`);
  }

  return { headline, details };
}

// Creation Engine v10 — scaffold input
// This stays read-only and side-effect-free. It is consumed by the
// Creation Engine in a later chapter and MUST NOT directly influence
// prompts or memory from here.

export interface CreationEngineV10ScaffoldInput {
  /**
   * Version tag so downstream consumers can safely branch.
   */
  version: "v10-scaffold-1";

  /**
   * Optional user id (internal-only, never surfaced to the user).
   */
  userId?: string;

  /**
   * Session identifier associated with this scaffold.
   */
  sessionId: string;

  /**
   * ISO timestamp when this scaffold was computed.
   */
  timestamp: string;

  /**
   * Stable, low-cardinality labels for clinical vitals at this turn.
   */
  clinicalVitals: {
    mood: string;
    stress: string;
    focus: string;
    energy: string;
  };

  /**
   * Optional execution bias tag from the Execution–Emotion Gap Engine.
   */
  executionBiasTag?: string;

  /**
   * Optional reflection headline from the reflection engine.
   */
  reflectionHeadline?: string;

  /**
   * Optional statistical self-study summary snapshot.
   */
  statisticalSummary: StatisticalSelfStudySummary | null;
}

/**
 * Build a lightweight, read-only scaffold object that can later be
 * consumed by Creation Engine v10. This function is intentionally
 * side-effect-free and carries no persistence or prompt wiring.
 */
export function buildCreationEngineV10ScaffoldInput(args: {
  userId?: string;
  sessionId: string;
  timestamp: string;
  clinicalVitals: {
    mood: string;
    stress: string;
    focus: string;
    energy: string;
  };
  executionBiasTag?: string;
  reflectionHeadline?: string;
  statisticalSummary: StatisticalSelfStudySummary | null;
}): CreationEngineV10ScaffoldInput {
  const {
    userId,
    sessionId,
    timestamp,
    clinicalVitals,
    executionBiasTag,
    reflectionHeadline,
    statisticalSummary,
  } = args;

  return {
    version: "v10-scaffold-1",
    userId,
    sessionId,
    timestamp,
    clinicalVitals: {
      mood: clinicalVitals.mood ?? "unknown",
      stress: clinicalVitals.stress ?? "unknown",
      focus: clinicalVitals.focus ?? "unknown",
      energy: clinicalVitals.energy ?? "unknown",
    },
    executionBiasTag,
    reflectionHeadline,
    statisticalSummary,
  };
}

