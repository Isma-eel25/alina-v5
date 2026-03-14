"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
export type LocusMode = "calm" | "analytical" | "intense" | "reflective";

export interface LocusMemory {
  id: string;
  createdAt: string;
  diary: string;
}

export interface AlinaLocusProps {
  mode: LocusMode;
  sessionCount: number;
  messageCount: number;
  totalMessageCount: number;
  memories: LocusMemory[];
  userProfile?: string | null;
  isStreaming?: boolean;
  lastUpdated?: string | null;
  vitals?: { energy: number; mood: number; focus: number; clarity: number; confidence: number; moodLabel?: string };
  executionGapHint?: string | null;
  contradictionHint?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MODE_META: Record<LocusMode, { label: string; accent: string; glow: string; ring: string; orb: string }> = {
  calm:       { label: "CALM",       accent: "text-cyan-400",   glow: "rgba(6,182,212,0.12)",   ring: "border-cyan-500/20",   orb: "bg-cyan-400" },
  analytical: { label: "ANALYTICAL", accent: "text-blue-400",   glow: "rgba(96,165,250,0.12)",  ring: "border-blue-500/20",   orb: "bg-blue-400" },
  intense:    { label: "INTENSE",    accent: "text-orange-400", glow: "rgba(251,146,60,0.18)",  ring: "border-orange-500/25", orb: "bg-orange-400" },
  reflective: { label: "REFLECTIVE", accent: "text-violet-400", glow: "rgba(167,139,250,0.12)", ring: "border-violet-500/20", orb: "bg-violet-400" },
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);
  const fromRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  useEffect(() => {
    fromRef.current = display;
    startRef.current = performance.now();
    const animate = (now: number) => {
      const p = Math.min((now - startRef.current) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(fromRef.current + (value - fromRef.current) * ease));
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);
  return <>{display}</>;
}

function VitalBar({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(value), 120); return () => clearTimeout(t); }, [value]);
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-mono tracking-widest text-slate-500 uppercase">{label}</span>
        <span className={"text-[10px] font-mono " + color}><AnimatedNumber value={value} /></span>
      </div>
      <div className={"h-1 rounded-full overflow-hidden " + bg}>
        <div className={"h-full rounded-full transition-all duration-1000 ease-out " + color.replace("text-","bg-")}
             style={{ width: w + "%", opacity: 0.85 }} />
      </div>
    </div>
  );
}

function PulseOrb({ mode, streaming }: { mode: LocusMode; streaming: boolean }) {
  const m = MODE_META[mode];
  return (
    <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
      <div className={"absolute inset-0 rounded-full opacity-10 " + m.orb + (streaming ? " animate-ping" : "")}
           style={{ animationDuration: "1.5s" }} />
      <div className={"absolute inset-1 rounded-full opacity-20 " + m.orb + (streaming ? " animate-pulse" : "")} />
      <div className={"relative w-2.5 h-2.5 rounded-full shadow-lg " + m.orb}
           style={{ boxShadow: "0 0 10px 3px " + m.glow }} />
    </div>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={"text-lg font-bold font-mono leading-none " + accent}><AnimatedNumber value={value} /></span>
      <span className="text-[9px] text-slate-600 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function MemoryFeedItem({ memory, accent }: { memory: LocusMemory; accent: string }) {
  const date = new Date(memory.createdAt);
  const dayLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const snippet = memory.diary.length > 90 ? memory.diary.slice(0, 90) + "..." : memory.diary;
  return (
    <div className="flex gap-2.5">
      <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
        <div className={"w-1.5 h-1.5 rounded-full opacity-60 " + accent.replace("text-","bg-")} />
        <div className="w-px flex-1 bg-slate-800/60 min-h-[16px]" />
      </div>
      <div className="pb-3 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={"text-[9px] font-mono opacity-70 " + accent}>{dayLabel}</span>
          <span className="text-[9px] text-slate-700">{timeLabel}</span>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">{snippet}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export const AlinaLocus: React.FC<AlinaLocusProps> = ({
  mode, sessionCount, messageCount, totalMessageCount,
  memories, userProfile, isStreaming = false, lastUpdated,
  vitals, executionGapHint, contradictionHint,
}) => {
  const meta = MODE_META[mode];
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(true);
  const prevMode = useRef(mode);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prevMode.current !== mode) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      prevMode.current = mode;
      return () => clearTimeout(t);
    }
  }, [mode]);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => !t), 1400);
    return () => clearInterval(iv);
  }, []);

  const recentMemories = useMemo(() => memories.slice(0, 5), [memories]);

  // ── COLLAPSED STRIP ────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={"w-full flex items-center justify-between px-4 py-2 border-b " + meta.ring + " bg-[#070d1a]/80 backdrop-blur-md hover:bg-[#0c1424]/80 transition-all group"}
        style={{ boxShadow: "0 1px 20px 0 " + meta.glow }}
      >
        <div className="flex items-center gap-2.5">
          <PulseOrb mode={mode} streaming={isStreaming} />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-slate-300 font-mono">ALINA</span>
            <span className={"text-[10px] font-mono " + meta.accent}>V∞</span>
            <span className={"ml-1 text-[9px] font-mono tracking-widest opacity-60 border px-1.5 py-0.5 rounded " + meta.accent + " " + meta.ring}>
              {meta.label}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 opacity-50">
            <span className="text-[9px] font-mono text-slate-500">{totalMessageCount} msgs</span>
            <span className="text-[9px] font-mono text-slate-500">{memories.length} mem</span>
          </div>
          <div className="flex items-center gap-1">
            <div className={"w-1 h-1 rounded-full bg-green-500 transition-opacity duration-300 " + (tick ? "opacity-100" : "opacity-20")} />
            {lastUpdated && <span className="text-[9px] font-mono text-slate-700">{lastUpdated}</span>}
          </div>
          <svg className={"w-3 h-3 opacity-40 group-hover:opacity-80 transition-opacity " + meta.accent} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
    );
  }

  // ── EXPANDED DASHBOARD ─────────────────────────────────────────────────────
  return (
    <div className={"w-full border-b " + meta.ring + " bg-[#060c18]/90 backdrop-blur-xl transition-all duration-300 " + (flash ? "brightness-125" : "")}
         style={{ boxShadow: "0 2px 40px 0 " + meta.glow }}>

      {/* TOP BAR */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <PulseOrb mode={mode} streaming={isStreaming} />
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-bold tracking-[0.15em] text-white font-mono">ALINA</span>
              <span className={"text-[10px] font-mono " + meta.accent}>V∞</span>
              <span className={"text-[9px] font-mono tracking-widest opacity-60 border px-1.5 py-0.5 rounded ml-1 " + meta.accent + " " + meta.ring}>
                {meta.label}
              </span>
              {isStreaming && <span className="text-[9px] font-mono text-orange-400 animate-pulse ml-1">● LIVE</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={"w-1 h-1 rounded-full bg-green-500 transition-opacity duration-300 " + (tick ? "opacity-100" : "opacity-20")} />
              <span className="text-[9px] font-mono text-slate-600">
                {lastUpdated ? "synced " + lastUpdated : "initializing"}
              </span>
            </div>
          </div>
        </div>
        <button onClick={() => setExpanded(false)}
                className={"p-1.5 rounded-lg opacity-40 hover:opacity-80 transition-opacity " + meta.accent}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {/* 3-COLUMN BODY */}
      <div className="grid grid-cols-3 divide-x divide-white/[0.04]">

        {/* COL 1: IDENTITY */}
        <div className="p-4 space-y-4">
          <p className={"text-[9px] font-mono tracking-widest uppercase opacity-60 " + meta.accent}>Identity</p>
          <div className="flex justify-around">
            <StatBlock label="Sessions"  value={sessionCount}      accent={meta.accent} />
            <StatBlock label="Messages"  value={totalMessageCount} accent={meta.accent} />
            <StatBlock label="Memories"  value={memories.length}   accent={meta.accent} />
          </div>
          {userProfile ? (
            <div className={"rounded-lg border bg-white/[0.02] p-2.5 " + meta.ring}>
              <p className={"text-[9px] font-mono opacity-60 mb-1 uppercase tracking-widest " + meta.accent}>Profile</p>
              <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{userProfile}</p>
            </div>
          ) : (
            <div className={"rounded-lg border bg-white/[0.02] p-2.5 text-center " + meta.ring}>
              <p className="text-[10px] text-slate-700">Profile builds with conversation.</p>
            </div>
          )}
        </div>

        {/* COL 2: VITALS */}
        <div className="p-4 space-y-4">
          <p className={"text-[9px] font-mono tracking-widest uppercase opacity-60 " + meta.accent}>Vitals</p>
          {vitals ? (
            <div className="space-y-3">
              <VitalBar label="Energy"     value={vitals.energy}     color="text-cyan-400"   bg="bg-cyan-950/40" />
              <VitalBar label="Focus"      value={vitals.focus}      color="text-blue-400"   bg="bg-blue-950/40" />
              <VitalBar label="Clarity"    value={vitals.clarity}    color="text-violet-400" bg="bg-violet-950/40" />
              <VitalBar label="Confidence" value={vitals.confidence} color="text-orange-400" bg="bg-orange-950/40" />
              <div className="flex justify-between items-center pt-1.5 border-t border-white/[0.04] mt-1">
                <span className="text-[9px] font-mono tracking-widest text-slate-500 uppercase">Mood</span>
                <span className={
                  "text-[10px] font-mono " +
                  (["high","good","excited","focused","frustrated_but_focused","engaged"].includes(vitals.moodLabel ?? "") ? "text-green-400" :
                   ["low","very_low","overwhelmed","disengaged"].includes(vitals.moodLabel ?? "") ? "text-red-400" : "text-slate-400")
}>{(vitals.moodLabel ?? "neutral").replace(/_/g, " ")}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {["Energy","Mood","Focus","Clarity","Confidence"].map((l) => (
                <div key={l} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[9px] font-mono text-slate-700 uppercase tracking-widest">{l}</span>
                    <span className="text-[9px] font-mono text-slate-800">—</span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-900/80" />
                </div>
              ))}
              <p className="text-[9px] text-slate-700 text-center pt-1">Fills from /api/reflect</p>
            </div>
          )}
          {(executionGapHint || contradictionHint) && (
            <div className="space-y-2 pt-2 border-t border-white/[0.04]">
              {executionGapHint && (
                <div className="flex gap-1.5 items-start">
                  <span className="text-orange-400 text-[10px] mt-px shrink-0">⏱</span>
                  <p className="text-[10px] text-slate-500 leading-snug">{executionGapHint}</p>
                </div>
              )}
              {contradictionHint && (
                <div className="flex gap-1.5 items-start">
                  <span className="text-yellow-400 text-[10px] mt-px shrink-0">⚡</span>
                  <p className="text-[10px] text-slate-500 leading-snug">{contradictionHint}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* COL 3: MEMORY TIMELINE */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className={"text-[9px] font-mono tracking-widest uppercase opacity-60 " + meta.accent}>Memory</p>
            <span className="text-[9px] font-mono text-slate-700">{memories.length} total</span>
          </div>
          {recentMemories.length > 0 ? (
            <div className="overflow-y-auto max-h-40 custom-scrollbar">
              {recentMemories.map((m) => (
                <MemoryFeedItem key={m.id} memory={m} accent={meta.accent} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-28 gap-2">
              <div className={"w-8 h-8 rounded-full border flex items-center justify-center opacity-30 " + meta.ring}>
                <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-[10px] text-slate-700 text-center leading-snug">Memories form as<br/>you converse.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default AlinaLocus;
