import { redirect } from "next/navigation";
import { Pool } from "pg";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ConversationRow = {
  id: string;
  user_id: string;
  user_message: string;
  assistant_message: string;
  created_at: string;
};

type FeedbackRow = {
  id: string;
  user_id: string;
  message_id: string;
  rating: "helpful" | "not_helpful";
  comment: string | null;
  created_at: string;
};

type MemoryEventRow = {
  id: string;
  user_id: string;
  source: string;
  summary: string;
  created_at: string;
  created_at_human: string | null;
};

type DashboardData = {
  conversations: ConversationRow[];
  feedback: FeedbackRow[];
  memoryEvents: MemoryEventRow[];
  errors: Array<{ at: string; message: string }>;
};

const PANEL =
  "rounded-2xl border border-cyan-500/15 bg-slate-900/70 backdrop-blur p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.03)]";

let pool: Pool | null = null;

function normalizeDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!u.searchParams.get("sslmode")) u.searchParams.set("sslmode", "require");
    if (!u.searchParams.get("uselibpqcompat")) {
      u.searchParams.set("uselibpqcompat", "true");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function getPool(): Pool {
  if (pool) return pool;

  const rawConnectionString =
    process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || "";

  if (!rawConnectionString) {
    throw new Error(
      "Missing DATABASE_URL (or POSTGRES_URL_NON_POOLING). Alina Lab cannot read founder telemetry without the memory database."
    );
  }

  pool = new Pool({
    connectionString: normalizeDatabaseUrl(rawConnectionString),
    ssl: {
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    },
    max: 3,
  });

  return pool;
}

function getAllowedFounderEmails(): string[] {
  return [
    process.env.ALINA_FOUNDER_EMAILS,
    process.env.ALINA_FOUNDER_EMAIL,
    process.env.FOUNDER_EMAIL,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isFounderEmail(email: string | undefined, allowlist: string[]): boolean {
  if (!email) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

function truncate(text: string, max = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadDashboardData(): Promise<DashboardData> {
  const db = getPool();

  const [conversationsRes, feedbackRes, memoryRes] = await Promise.all([
    db.query<ConversationRow>(
      `
        SELECT id, user_id, user_message, assistant_message, created_at
        FROM conversation_turns
        ORDER BY created_at DESC
        LIMIT 50
      `
    ),
    db.query<FeedbackRow>(
      `
        SELECT id, user_id, message_id, rating, comment, created_at
        FROM feedback
        ORDER BY created_at DESC
        LIMIT 50
      `
    ),
    db.query<MemoryEventRow>(
      `
        SELECT id, user_id, source, summary, created_at, created_at_human
        FROM long_term_memory
        ORDER BY created_at DESC
        LIMIT 50
      `
    ),
  ]);

  return {
    conversations: conversationsRes.rows,
    feedback: feedbackRes.rows,
    memoryEvents: memoryRes.rows,
    errors: [],
  };
}

export default async function AlinaLabPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const founderEmails = getAllowedFounderEmails();
  const authorized = isFounderEmail(user.email, founderEmails);

  if (!authorized) {
    return (
      <main className="min-h-screen bg-slate-950 text-white px-6 py-10">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-500/20 bg-slate-900/80 p-8 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-300/80">
            Access denied
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Alina Lab is founder-only.</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            This route is now server-guarded. Your session exists, but your email is not on the
            founder allowlist.
          </p>
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
            <p>
              Expected env setup: <code className="text-cyan-300">ALINA_FOUNDER_EMAILS</code>
            </p>
            <p className="mt-2">Use a comma-separated list so you can add backup founder/admin accounts later.</p>
          </div>
        </div>
      </main>
    );
  }

  let data: DashboardData | null = null;
  let loadError: string | null = null;

  try {
    data = await loadDashboardData();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unknown dashboard load error.";
  }

  const helpfulCount = data?.feedback.filter((item) => item.rating === "helpful").length ?? 0;
  const notHelpfulCount = data?.feedback.filter((item) => item.rating === "not_helpful").length ?? 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col gap-4 rounded-3xl border border-cyan-500/15 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.15),transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.96))] p-8 shadow-2xl shadow-cyan-950/30">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
              Founder Dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Alina Lab</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              This is the first founder view: raw conversations, direct feedback, memory events,
              and an error lane placeholder. Tiny telescope first, observatory later.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className={PANEL}>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Recent turns</p>
              <p className="mt-3 text-3xl font-semibold">{data?.conversations.length ?? 0}</p>
              <p className="mt-2 text-sm text-slate-400">Latest 50 logged conversation pairs.</p>
            </div>
            <div className={PANEL}>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Helpful</p>
              <p className="mt-3 text-3xl font-semibold text-emerald-300">{helpfulCount}</p>
              <p className="mt-2 text-sm text-slate-400">Positive user signal from thumbs-up.</p>
            </div>
            <div className={PANEL}>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Not helpful</p>
              <p className="mt-3 text-3xl font-semibold text-amber-300">{notHelpfulCount}</p>
              <p className="mt-2 text-sm text-slate-400">Most actionable friction signal right now.</p>
            </div>
            <div className={PANEL}>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Memory events</p>
              <p className="mt-3 text-3xl font-semibold text-cyan-300">{data?.memoryEvents.length ?? 0}</p>
              <p className="mt-2 text-sm text-slate-400">Latest long-term memory writes entering the system.</p>
            </div>
          </div>
        </section>

        {loadError ? (
          <section className="rounded-3xl border border-red-500/20 bg-red-500/5 p-6 text-red-100">
            <h2 className="text-xl font-semibold">Lab load failure</h2>
            <p className="mt-3 text-sm leading-7 text-red-100/90">{loadError}</p>
          </section>
        ) : null}

        {!loadError && data ? (
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <section className={`${PANEL} overflow-hidden`}>
              <div className="flex items-center justify-between gap-3 border-b border-cyan-500/10 pb-4">
                <div>
                  <h2 className="text-xl font-semibold">Recent conversations</h2>
                  <p className="mt-1 text-sm text-slate-400">Newest message pairs captured at the brain route.</p>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {data.conversations.length === 0 ? (
                  <p className="text-sm text-slate-400">No conversation telemetry yet.</p>
                ) : (
                  data.conversations.map((item) => (
                    <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{formatStamp(item.created_at)}</span>
                        <span>•</span>
                        <code className="rounded bg-slate-900 px-2 py-0.5 text-[11px] text-cyan-300">
                          {item.user_id}
                        </code>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">User</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                            {truncate(item.user_message, 500)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-cyan-500/10 bg-cyan-950/10 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/70">Alina</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                            {truncate(item.assistant_message, 700)}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <div className="space-y-6">
              <section className={PANEL}>
                <div className="border-b border-cyan-500/10 pb-4">
                  <h2 className="text-xl font-semibold">Feedback signals</h2>
                  <p className="mt-1 text-sm text-slate-400">Direct user judgment attached to reply message IDs.</p>
                </div>

                <div className="mt-4 space-y-3">
                  {data.feedback.length === 0 ? (
                    <p className="text-sm text-slate-400">No feedback captured yet.</p>
                  ) : (
                    data.feedback.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                              item.rating === "helpful"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {item.rating === "helpful" ? "Helpful" : "Not Helpful"}
                          </span>
                          <span className="text-xs text-slate-500">{formatStamp(item.created_at)}</span>
                        </div>

                        <p className="mt-3 text-xs text-slate-500">
                          Message ID: <code className="text-cyan-300">{item.message_id}</code>
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          User: <code className="text-cyan-300">{item.user_id}</code>
                        </p>

                        {item.comment ? (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">{item.comment}</p>
                        ) : (
                          <p className="mt-3 text-sm italic text-slate-500">No comment left.</p>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className={PANEL}>
                <div className="border-b border-cyan-500/10 pb-4">
                  <h2 className="text-xl font-semibold">Memory events</h2>
                  <p className="mt-1 text-sm text-slate-400">Latest long-term memory writes reaching storage.</p>
                </div>

                <div className="mt-4 space-y-3">
                  {data.memoryEvents.length === 0 ? (
                    <p className="text-sm text-slate-400">No memory events yet.</p>
                  ) : (
                    data.memoryEvents.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="rounded-full bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
                            {item.source}
                          </span>
                          <span className="text-xs text-slate-500">
                            {item.created_at_human || formatStamp(item.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          User: <code className="text-cyan-300">{item.user_id}</code>
                        </p>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                          {truncate(item.summary, 320)}
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className={PANEL}>
                <div className="border-b border-cyan-500/10 pb-4">
                  <h2 className="text-xl font-semibold">Error lane</h2>
                  <p className="mt-1 text-sm text-slate-400">Placeholder panel for app/runtime failures.</p>
                </div>
                <div className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-400">
                  {data.errors.length === 0 ? (
                    <>
                      No error feed is wired into the Lab yet. Current source of truth is still your
                      Vercel/runtime logs. Next step is to persist structured app errors into storage so
                      this panel stops being decorative furniture.
                    </>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
