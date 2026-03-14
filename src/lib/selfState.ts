// src/lib/selfState.ts
// 🧬 Alina Self-State v1 — "Alina about Alina"
// Stores:
// - Latest personality state snapshot
// - (Future) recent phrases, dominant modes, trait history
//
// v1 focus: persist PersonalityState so Alina can "wake up" different across sessions.

import { Pool } from "pg";
import type { PersonalityState } from "./personalityState";

const TABLE_NAME = "alina_self_state";

// Connection string strategy mirrors other PG-backed libs (e.g. longTermMemory).
const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DB_URL ||
  null;

let pool: Pool | null = null;

function getPool(): Pool {
  if (!connectionString) {
    throw new Error(
      "[selfState] No database connection string found. Set SUPABASE_DB_URL or POSTGRES_URL or DATABASE_URL."
    );
  }
  if (!pool) {
    // Strip any sslmode param from the connection string so it doesn't
    // conflict with the explicit ssl object we pass to the Pool constructor.
    let conn = connectionString;
    try {
      const u = new URL(conn);
      u.searchParams.delete("sslmode");
      conn = u.toString();
    } catch {
      // not a valid URL, use as-is
    }

    pool = new Pool({
      connectionString: conn,
      max: 5,
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      },
    });
  }
  return pool;
}

let tableEnsured = false;

async function ensureTable() {
  if (tableEnsured) return;
  const client = getPool();
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      user_id text PRIMARY KEY,
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      personality_state_json jsonb,
      recent_phrases text[] DEFAULT '{}'::text[],
      dominant_modes jsonb,
      trait_history jsonb
    );
  `);
  tableEnsured = true;
}

export type SelfStateRow = {
  userId: string;
  updatedAt: string;
  personalityState: PersonalityState | null;
  recentPhrases: string[];
  dominantModes: Record<string, any> | null;
  traitHistory: Record<string, any> | null;
};

function mapRow(row: any): SelfStateRow {
  return {
    userId: row.user_id,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    personalityState: (row.personality_state_json ?? null) as PersonalityState | null,
    recentPhrases: (row.recent_phrases ?? []) as string[],
    dominantModes: (row.dominant_modes ?? null) as any,
    traitHistory: (row.trait_history ?? null) as any,
  };
}

export async function getSelfState(
  userId: string
): Promise<SelfStateRow | null> {
  if (!userId) return null;
  const client = getPool();
  await ensureTable();

  const res = await client.query(
    `SELECT * FROM ${TABLE_NAME} WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!res.rows?.length) return null;
  return mapRow(res.rows[0]);
}

export async function upsertPersonalityStateSnapshot(
  userId: string,
  personalityState: PersonalityState
): Promise<SelfStateRow> {
  if (!userId) {
    throw new Error("[selfState] upsertPersonalityStateSnapshot called without userId");
  }
  const client = getPool();
  await ensureTable();

  const res = await client.query(
    `
    INSERT INTO ${TABLE_NAME} (user_id, personality_state_json, updated_at)
    VALUES ($1, $2, timezone('utc', now()))
    ON CONFLICT (user_id)
    DO UPDATE SET
      personality_state_json = EXCLUDED.personality_state_json,
      updated_at = EXCLUDED.updated_at
    RETURNING *;
  `,
    [userId, personalityState as any]
  );

  return mapRow(res.rows[0]);
}
