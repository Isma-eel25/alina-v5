// src/lib/longTermMemory.ts
// 🧠 Long-term memory v2 – "Clinical recall" storage (Supabase Postgres + pg)
// Auto-migrates table by adding missing columns if needed.

import { Pool } from "pg";

export type LongTermMemorySource = "reflection" | "fact" | "event";

export type ClinicalMood =
  | "very_low"
  | "low"
  | "neutral"
  | "good"
  | "high"
  | "unknown";

export type LongTermMemoryEntry = {
  id: string;
  userId: string;
  createdAt: string; // ISO
  createdAtHuman: string;

  source: LongTermMemorySource;

  summary: string;

  tags?: string[];
  mood?: ClinicalMood;
  confidence?: number; // 0..1
  alinaNotes?: string;
  sourceMessage?: string;
  extra?: Record<string, any>;
};

const DEFAULT_MAX_ENTRIES = 500;

function safeDate(dateLike: string | Date): Date {
  const d = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  return isNaN(d.getTime()) ? new Date() : d;
}

function formatHumanTime(iso: string): string {
  const d = safeDate(iso);
  try {
    const fmt = new Intl.DateTimeFormat("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return fmt.format(d).replace(/\u200E|\u200F/g, "");
  } catch {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
      d.getUTCDate()
    )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  }
}

function generateId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.searchParams.get("sslmode")) u.searchParams.set("sslmode", "require");
    if (!u.searchParams.get("uselibpqcompat"))
      u.searchParams.set("uselibpqcompat", "true");
    return u.toString();
  } catch {
    return raw;
  }
}

const rawConnectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || "";
const connectionString = rawConnectionString
  ? normalizeDatabaseUrl(rawConnectionString)
  : "";

let pool: Pool | null = null;
let didInit = false;

function getHostFromConnectionString(cs: string): string {
  try {
    const u = new URL(cs);
    return u.hostname;
  } catch {
    return "(unparseable)";
  }
}

function parseJson<T>(value: any): T | undefined {
  if (!value || typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

async function initOnce() {
  if (didInit) return;

  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL (or POSTGRES_URL_NON_POOLING). Check .env.local."
    );
  }

  console.log(
    "[LTM] Using pg driver. DB host:",
    getHostFromConnectionString(connectionString)
  );

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    },
    max: 5,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS long_term_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      created_at_human TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL
    );
  `);

  await pool.query(
    `ALTER TABLE long_term_memory ADD COLUMN IF NOT EXISTS tags_json TEXT NULL;`
  );
  await pool.query(
    `ALTER TABLE long_term_memory ADD COLUMN IF NOT EXISTS mood TEXT NULL;`
  );
  await pool.query(
    `ALTER TABLE long_term_memory ADD COLUMN IF NOT EXISTS confidence REAL NULL;`
  );
  await pool.query(
    `ALTER TABLE long_term_memory ADD COLUMN IF NOT EXISTS alina_notes TEXT NULL;`
  );
  await pool.query(
    `ALTER TABLE long_term_memory ADD COLUMN IF NOT EXISTS source_message TEXT NULL;`
  );
  await pool.query(
    `ALTER TABLE long_term_memory ADD COLUMN IF NOT EXISTS extra_json TEXT NULL;`
  );

  await pool.query(`
    CREATE INDEX IF NOT EXISTS long_term_memory_user_time_idx
    ON long_term_memory (user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS long_term_memory_user_source_idx
    ON long_term_memory (user_id, source);
  `);

  didInit = true;
}

/* ---------------- Source Weighting ---------------- */

function getSourceWeight(source: LongTermMemorySource): number {
  switch (source) {
    case "reflection":
      return 1.25;
    case "fact":
      return 1.15;
    case "event":
    default:
      return 1.0;
  }
}

/* ---------------- Public API (PATCHED: missing exports) ---------------- */
/**
 * Your /api/brain and /api/reflect routes expect these exports to exist.
 * These are thin, behavior-preserving wrappers around the same DB/table.
 * No scoring changes. No retrieval logic changes. No new features.
 */

export async function addMemoryEntry(entry: {
  userId: string;
  source: LongTermMemorySource;
  summary: string;
  tags?: string[];
  mood?: ClinicalMood;
  confidence?: number; // 0..1
  alinaNotes?: string;
  sourceMessage?: string;
  extra?: Record<string, any>;
  createdAtIso?: string; // optional override
}): Promise<LongTermMemoryEntry> {
  await initOnce();
  if (!pool) throw new Error("DB pool not initialized");

  const createdAt =
    typeof entry.createdAtIso === "string" && entry.createdAtIso.trim().length > 0
      ? safeDate(entry.createdAtIso).toISOString()
      : new Date().toISOString();

  const createdAtHuman = formatHumanTime(createdAt);

  const row: LongTermMemoryEntry = {
    id: generateId(),
    userId: entry.userId,
    createdAt,
    createdAtHuman,
    source: entry.source,
    summary: entry.summary,
    tags: entry.tags,
    mood: entry.mood,
    confidence:
      typeof entry.confidence === "number" ? clamp01(entry.confidence) : undefined,
    alinaNotes: entry.alinaNotes,
    sourceMessage: entry.sourceMessage,
    extra: entry.extra,
  };

  await pool.query(
    `
    INSERT INTO long_term_memory
      (id, user_id, created_at, created_at_human, source, summary, tags_json, mood, confidence, alina_notes, source_message, extra_json)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `,
    [
      row.id,
      row.userId,
      row.createdAt,
      row.createdAtHuman,
      row.source,
      row.summary,
      row.tags ? JSON.stringify(row.tags) : null,
      row.mood ?? null,
      typeof row.confidence === "number" ? row.confidence : null,
      row.alinaNotes ?? null,
      row.sourceMessage ?? null,
      row.extra ? JSON.stringify(row.extra) : null,
    ]
  );

  return row;
}

/**
 * /api/reflect imports this exact name.
 * This is a simple wrapper that writes a reflection memory.
 */
export async function addMemoryFromReflection(options: {
  userId: string;
  diary: string;
  vitals?: any | null;
  summary?: string; // optional override; if absent we store diary as summary
  mood?: ClinicalMood;
  confidence?: number;
  tags?: string[];
  alinaNotes?: string;
  sourceMessage?: string;
  extra?: Record<string, any>;
}): Promise<LongTermMemoryEntry> {
  const summary =
    (options.summary && options.summary.trim().length > 0
      ? options.summary
      : options.diary) || "";

  return addMemoryEntry({
    userId: options.userId,
    source: "reflection",
    summary,
    mood: options.mood,
    confidence: options.confidence,
    tags: options.tags,
    alinaNotes: options.alinaNotes,
    sourceMessage: options.sourceMessage,
    extra: {
      ...(options.extra ?? {}),
      // Keep these optional and non-breaking. If reflect route uses them, they're here.
      diary: options.diary,
      vitals: options.vitals ?? null,
    },
  });
}

/**
 * /api/brain compat loader expects a "getRecentMemories"-like export.
 * We provide a canonical one: recent memories for a user, newest-first.
 */
export async function getRecentMemories(options: {
  userId: string;
  limit?: number;
  source?: LongTermMemorySource | null;
}): Promise<LongTermMemoryEntry[]> {
  await initOnce();
  if (!pool) throw new Error("DB pool not initialized");

  const limit = Math.max(
    1,
    Math.min(
      DEFAULT_MAX_ENTRIES,
      typeof options.limit === "number" ? options.limit : 40
    )
  );

  const hasSource = !!options.source;

  const res = hasSource
    ? await pool.query(
        `
        SELECT *
        FROM long_term_memory
        WHERE user_id = $1 AND source = $2
        ORDER BY created_at DESC
        LIMIT $3
      `,
        [options.userId, options.source, limit]
      )
    : await pool.query(
        `
        SELECT *
        FROM long_term_memory
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
        [options.userId, limit]
      );

  return res.rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    createdAt: new Date(r.created_at).toISOString(),
    createdAtHuman: r.created_at_human,
    source: r.source,
    summary: r.summary,
    tags: parseJson<string[]>(r.tags_json),
    mood: (r.mood as ClinicalMood) ?? undefined,
    confidence: typeof r.confidence === "number" ? clamp01(r.confidence) : undefined,
    alinaNotes: r.alina_notes ?? undefined,
    sourceMessage: r.source_message ?? undefined,
    extra: parseJson<Record<string, any>>(r.extra_json),
  }));
}



/**
 * Convenience helper: latest reflection entry for a user (or null if none).
 * Useful for Autonomous Reflection Loops to inject a distilled signal into the system prompt.
 */
export async function getLatestReflectionEntry(
  userId: string
): Promise<LongTermMemoryEntry | null> {
  const list = await getRecentMemories({
    userId,
    limit: 1,
    source: "reflection",
  });
  return list.length > 0 ? list[0] : null;
}
/* ---------------- Precision Timestamped Memory Recall (v2 scoring) ---------------- */

type ScoredMemory = {
  entry: LongTermMemoryEntry;
  relevance: number;
  recencyBoost: number;
  proximityMs: number;
  total: number;
};

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/\b[a-z0-9]+\b/g) || []).filter(Boolean);
}

function keywordOverlapScore(memorySummary: string, queryText: string): number {
  const memTokens = tokenize(memorySummary);
  const qryTokens = tokenize(queryText);

  if (memTokens.length === 0 || qryTokens.length === 0) return 0;

  const memSet = new Set(memTokens);
  const qrySet = new Set(qryTokens);

  let overlap = 0;
  for (const token of memSet) if (qrySet.has(token)) overlap += 1;

  return overlap / memSet.size;
}

function computeRecencyBoost(createdAtIso: string, now: Date): number {
  const createdAt = safeDate(createdAtIso);
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const boost = 0.25 / (1 + ageDays);
  return Math.max(0, Math.min(0.25, boost));
}

export async function retrievePrecisionMemories(options: {
  userId: string;
  queryText: string;
  limit?: number;
  targetTimeIso?: string | null;
}): Promise<LongTermMemoryEntry[]> {
  await initOnce();
  if (!pool) throw new Error("DB pool not initialized");

  const { userId, queryText, limit = 6, targetTimeIso } = options;

  const res = await pool.query(
    `
    SELECT *
    FROM long_term_memory
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 400
  `,
    [userId]
  );

  const now = new Date();
  const target = targetTimeIso ? safeDate(targetTimeIso) : now;

  const candidates: LongTermMemoryEntry[] = res.rows.map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    createdAt: new Date(r.created_at).toISOString(),
    createdAtHuman: r.created_at_human,
    source: r.source,
    summary: r.summary,
    tags: parseJson<string[]>(r.tags_json),
    mood: (r.mood as ClinicalMood) ?? undefined,
    confidence:
      typeof r.confidence === "number" ? clamp01(r.confidence) : undefined,
    alinaNotes: r.alina_notes ?? undefined,
    sourceMessage: r.source_message ?? undefined,
    extra: parseJson<Record<string, any>>(r.extra_json),
  }));

  const scored: ScoredMemory[] = candidates.map((entry) => {
    const relevance = keywordOverlapScore(entry.summary ?? "", queryText);
    const recencyBoost = computeRecencyBoost(entry.createdAt, now);

    const createdAt = safeDate(entry.createdAt);
    const proximityMs = Math.abs(createdAt.getTime() - target.getTime());
    const proximityDays = proximityMs / (1000 * 60 * 60 * 24);
    const proximityBoost = 0.08 / (1 + proximityDays);

    const sourceWeight = getSourceWeight(entry.source);
    const confidenceWeight =
      typeof entry.confidence === "number"
        ? 0.75 + entry.confidence * 0.5
        : 1.0;

    const baseScore = relevance + recencyBoost + proximityBoost;
    const total = baseScore * sourceWeight * confidenceWeight;

    return { entry, relevance, recencyBoost, proximityMs, total };
  });

  scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (a.proximityMs !== b.proximityMs) return a.proximityMs - b.proximityMs;
    return (
      safeDate(b.entry.createdAt).getTime() - safeDate(a.entry.createdAt).getTime()
    );
  });

  const anyRelevant = scored.some((s) => s.relevance > 0);
  if (!anyRelevant) return [];

  return scored
    .filter((s) => s.relevance > 0)
    .slice(0, limit)
    .map((s) => s.entry);
}

export async function clearAllMemories(userId?: string): Promise<void> {
  await initOnce();
  if (!pool) throw new Error("DB pool not initialized");

  if (userId && userId.trim().length > 0) {
    await pool.query(`DELETE FROM long_term_memory WHERE user_id = $1`, [userId]);
  } else {
    await pool.query(`DELETE FROM long_term_memory`);
  }
}
