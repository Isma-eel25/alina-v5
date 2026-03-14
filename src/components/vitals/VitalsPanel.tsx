// src/components/vitals/VitalsPanel.tsx

"use client";

import React from "react";
import type { VitalsSnapshot, ScalarVital } from "@/lib/vitals";

type Props = {
  vitals: VitalsSnapshot | null;
};

export const VitalsPanel: React.FC<Props> = ({ vitals }) => {
  if (!vitals) {
    return (
      <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-300">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Alina Vitals
        </div>
        <p className="text-zinc-400">
          No vitals yet. Log at least one reflection so Alina can calibrate.
        </p>
      </div>
    );
  }

  const { createdAt, stress, energy, focus, mood, notes, source } = vitals;
  const updatedLabel = new Date(createdAt).toLocaleString();

  return (
    <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-100">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Alina Vitals
          </div>
          <div className="text-[11px] text-zinc-500">
            Source: <span className="font-medium text-zinc-300">{formatSource(source)}</span>
          </div>
        </div>

        <div className="text-[10px] text-zinc-500">
          Updated <span className="font-medium text-zinc-300">{updatedLabel}</span>
        </div>
      </div>

      <div className="mb-3 rounded-lg bg-zinc-900/80 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
          Snapshot
        </div>
        <div className="mt-1 text-sm text-zinc-100">
          {buildHeadline({ stress, energy, focus, mood })}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
        <ScalarPill label="Stress" vital={stress} />
        <ScalarPill label="Energy" vital={energy} />
        <ScalarPill label="Focus" vital={focus} />
        <MoodPill label="Mood" labelValue={mood.label} intensity={mood.intensity} />
      </div>

      <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Notes
        </div>
        <div className="text-[11px] text-zinc-400">
          {notes?.trim()
            ? notes
            : "No notes yet. Alina will enrich this as more reflections and state updates come in."}
        </div>
      </div>
    </div>
  );
};

type ScalarPillProps = {
  label: string;
  vital: ScalarVital;
};

const ScalarPill: React.FC<ScalarPillProps> = ({ label, vital }) => {
  const trend = trendDisplay(vital.trend);

  return (
    <div className="rounded-2xl bg-zinc-900/80 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-zinc-100">{vital.value}</div>
        <div className={`flex items-center gap-1 text-[11px] ${trend.className}`}>
          <span>{trend.symbol}</span>
          <span>{trend.text}</span>
        </div>
      </div>
    </div>
  );
};

type MoodPillProps = {
  label: string;
  labelValue: string;
  intensity: number;
};

const MoodPill: React.FC<MoodPillProps> = ({ label, labelValue, intensity }) => {
  return (
    <div className="rounded-2xl bg-zinc-900/80 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold capitalize text-zinc-100">
        {labelValue.replaceAll("_", " ")}
      </div>
      <div className="mt-1 text-[11px] text-zinc-400">Intensity {intensity}</div>
    </div>
  );
};

function buildHeadline({
  stress,
  energy,
  focus,
  mood,
}: {
  stress: ScalarVital;
  energy: ScalarVital;
  focus: ScalarVital;
  mood: VitalsSnapshot["mood"];
}): string {
  const moodLabel = mood.label.replaceAll("_", " ");
  return `Mood is ${moodLabel} (${mood.intensity}/100). Stress ${stress.value}, energy ${energy.value}, and focus ${focus.value}.`;
}

function formatSource(source: VitalsSnapshot["source"]): string {
  switch (source) {
    case "user_reported":
      return "User reported";
    case "inferred":
      return "Inferred";
    case "system":
      return "System";
    default:
      return "Unknown";
  }
}

function trendDisplay(trend: ScalarVital["trend"]) {
  switch (trend) {
    case "up":
      return {
        symbol: "↗",
        text: "Rising",
        className: "text-emerald-300",
      };
    case "down":
      return {
        symbol: "↘",
        text: "Falling",
        className: "text-red-300",
      };
    case "stable":
    default:
      return {
        symbol: "→",
        text: "Stable",
        className: "text-zinc-300",
      };
  }
}
