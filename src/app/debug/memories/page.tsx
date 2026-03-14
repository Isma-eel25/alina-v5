"use client";

import { useEffect, useState } from "react";

type ClinicalMood = "very_low" | "low" | "neutral" | "good" | "high";

type LongTermMemoryEntry = {
  id: string;
  userId: string;

  createdAt: string;
  createdAtHuman?: string;

  source: string; // "event" | "reflection" | "fact" | ...
  summary: string;

  tags?: string[];

  // Clinical Memory Capture v1 (optional)
  mood?: ClinicalMood | string;
  confidence?: number;
  alinaNotes?: string;
  sourceMessage?: string;
};

type ApiResponse = {
  count: number;
  memories: LongTermMemoryEntry[];
};

type StructuredReflection = {
  loops?: string;
  levers?: string;
  strengths?: string;
  state?: string;
  narrative?: string;
  raw: string;
};

function parseStructuredReflection(text: string): StructuredReflection {
  const result: StructuredReflection = { raw: text };
  const sectionBuffers: Record<string, string[]> = {};
  let current:
    | "loops"
    | "levers"
    | "strengths"
    | "state"
    | "summary"
    | null = null;

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(
      /^\[(loops|levers|strengths|state|summary)\]$/i
    );
    if (headerMatch) {
      const key = headerMatch[1].toLowerCase() as
        | "loops"
        | "levers"
        | "strengths"
        | "state"
        | "summary";
      current = key;
      if (!sectionBuffers[key]) sectionBuffers[key] = [];
      continue;
    }

    if (current) {
      if (!sectionBuffers[current]) sectionBuffers[current] = [];
      sectionBuffers[current].push(line);
    }
  }

  const join = (key: string) => {
    const buf = sectionBuffers[key];
    if (!buf || buf.length === 0) return undefined;
    return buf.join(" ").trim();
  };

  result.loops = join("loops");
  result.levers = join("levers");
  result.strengths = join("strengths");
  result.state = join("state");
  const summary = join("summary");
  result.narrative = summary;

  return result;
}

function fmtConfidence(v: number | undefined): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  const clamped = Math.max(0, Math.min(1, v));
  return clamped.toFixed(2);
}

export default function MemoriesDebugPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMemories = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/debug/memories?limit=50", {
          method: "GET",
        });

        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }

        const json = (await res.json()) as ApiResponse;
        setData(json);
      } catch (err: any) {
        console.error("Failed to fetch memories:", err);
        setError(err?.message ?? "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchMemories();
  }, []);

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="border-b border-slate-300 pb-4 mb-4">
          <h1 className="text-2xl font-semibold">
            Alina Debug · Long-Term Memories
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Reflection + event memories currently stored. This page may show
            internal fields (mood/confidence/alinaNotes) for debugging only.
          </p>
        </header>

        {loading && (
          <p className="text-slate-700 text-sm">Loading memories…</p>
        )}

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
            <p className="font-medium text-red-700">Error</p>
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="flex items-center justify-between text-sm text-slate-700">
              <span>
                Total memories loaded:{" "}
                <span className="font-mono text-slate-900">{data.count}</span>
              </span>
              <span className="text-xs text-slate-500">
                Showing up to 50 most recent entries.
              </span>
            </div>

            {data.memories.length === 0 && (
              <p className="text-sm text-slate-600 mt-4">
                No long-term memories have been written yet. Trigger a message
                and refresh this page.
              </p>
            )}

            <div className="space-y-4 mt-4">
              {data.memories.map((m) => {
                const date = new Date(m.createdAt);
                const dateStr = isNaN(date.getTime())
                  ? m.createdAt
                  : date.toLocaleString();

                const structured = parseStructuredReflection(m.summary);

                const hasClinical =
                  typeof m.mood !== "undefined" ||
                  typeof m.confidence === "number" ||
                  typeof m.alinaNotes === "string" ||
                  typeof m.sourceMessage === "string";

                return (
                  <article
                    key={m.id}
                    className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <div className="flex flex-col gap-1 text-xs text-slate-600">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-slate-800">
                            {m.source}
                          </span>
                          <span>•</span>
                          <span>{dateStr}</span>
                          {m.createdAtHuman && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[10px] text-slate-500">
                                {m.createdAtHuman}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          userId: {m.userId}
                        </div>

                        {/* Clinical quick glance */}
                        {hasClinical && (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            {typeof m.mood !== "undefined" && (
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] uppercase tracking-wide text-slate-700">
                                mood: {String(m.mood)}
                              </span>
                            )}
                            {typeof m.confidence === "number" && (
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] uppercase tracking-wide text-slate-700">
                                conf: {fmtConfidence(m.confidence)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {m.tags && m.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 justify-end">
                          {m.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] uppercase tracking-wide text-slate-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Clinical block (debug only) */}
                    {hasClinical && (
                      <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 space-y-2">
                        {typeof m.sourceMessage === "string" &&
                          m.sourceMessage.trim().length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Source message
                              </div>
                              <p className="whitespace-pre-wrap">
                                {m.sourceMessage}
                              </p>
                            </div>
                          )}

                        {typeof m.alinaNotes === "string" &&
                          m.alinaNotes.trim().length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                Internal Alina notes (debug)
                              </div>
                              <p className="whitespace-pre-wrap font-mono text-[11px] text-slate-700">
                                {m.alinaNotes}
                              </p>
                            </div>
                          )}
                      </div>
                    )}

                    {/* Structured sections (reflection-style memories) */}
                    <div className="space-y-2 text-sm leading-relaxed text-slate-900">
                      {structured.loops && (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Loops
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {structured.loops}
                          </p>
                        </section>
                      )}

                      {structured.levers && (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Levers
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {structured.levers}
                          </p>
                        </section>
                      )}

                      {structured.strengths && (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Strengths
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {structured.strengths}
                          </p>
                        </section>
                      )}

                      {structured.state && (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            State
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {structured.state}
                          </p>
                        </section>
                      )}

                      {structured.narrative && (
                        <section>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Summary
                          </h3>
                          <p className="whitespace-pre-wrap">
                            {structured.narrative}
                          </p>
                        </section>
                      )}
                    </div>

                    {/* Fallback: raw blob if parsing failed */}
                    {!structured.loops &&
                      !structured.levers &&
                      !structured.strengths &&
                      !structured.state &&
                      !structured.narrative && (
                        <div className="mt-3 text-xs text-slate-600">
                          <p className="mb-1 font-semibold">
                            Raw summary (unstructured):
                          </p>
                          <p className="whitespace-pre-wrap text-slate-800">
                            {m.summary}
                          </p>
                        </div>
                      )}

                    <p className="mt-3 text-[10px] text-slate-500 break-all font-mono">
                      id: {m.id}
                    </p>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
