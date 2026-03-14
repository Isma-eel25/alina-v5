// src/components/vitals/VitalsPanel.tsx

"use client";

import React from "react";
import type { VitalsSnapshot } from "@/lib/vitals";

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

  const {
    horizon,
    generatedAt,
    energy,
    focus,
    emotionTrend,
    executionTrend,
    riskFlags,
    headline,
    nextStep,
  } = vitals;

  const horizonLabel = horizonLabelFromKey(horizon);
  const generatedLabel = new Date(generatedAt).toLocaleString();

  return (
    <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-100">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Alina Vitals
          </div>
          <div className="text-[11px] text-zinc-500">
            Horizon: <span className="font-medium text-zinc-300">{horizonLabel}</span>
          </div>
        </div>
        <div className="text-[10px] text-zinc-500">
          Updated{" "}
          <span className="font-medium text-zinc-300">{generatedLabel}</span>
        </div>
      </div>

      {/* Headline */}
      <div className="mb-3 rounded-lg bg-zinc-900/80 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
          Snapshot
        </div>
        <div className="mt-1 text-sm text-zinc-100">{headline}</div>
      </div>

      {/* Core stats: energy / focus / trends */}
      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
        <StatPill label="Energy" value={formatEnergy(energy)} />
        <StatPill label="Focus" value={formatFocus(focus)} />
        <TrendPill label="Emotion Trend" trend={emotionTrend} />
        <TrendPill label="Execution Trend" trend={executionTrend} />
      </div>

      {/* Risk flags */}
      <div className="mb-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Risk Flags
        </div>
        {riskFlags.length === 0 ? (
          <div className="rounded-md bg-zinc-900/70 px-3 py-2 text-[11px] text-zinc-400">
            No active risk signals. Treat this as permission to push, not to
            drift.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {riskFlags.map((flag) => (
              <RiskBadge key={flag.code} flag={flag} />
            ))}
          </div>
        )}
      </div>

      {/* Next step */}
      <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <div className="font-semibold uppercase tracking-wide text-zinc-500">
            Next Step
          </div>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
            {nextStep.kind === "user_action" ? "You" : "Alina"}
          </span>
        </div>
        <div className="text-xs font-semibold text-zinc-100">
          {nextStep.label}
        </div>
        <div className="mt-1 text-[11px] text-zinc-400">{nextStep.detail}</div>
      </div>
    </div>
  );
};

type StatPillProps = {
  label: string;
  value: string;
};

const StatPill: React.FC<StatPillProps> = ({ label, value }) => {
  return (
    <div className="rounded-full bg-zinc-900/80 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="text-[11px] font-medium text-zinc-100">{value}</div>
    </div>
  );
};

type TrendPillProps = {
  label: string;
  trend: "up" | "flat" | "down";
};

const TrendPill: React.FC<TrendPillProps> = ({ label, trend }) => {
  const { symbol, text, className } = trendDisplay(trend);
  return (
    <div className="flex items-center gap-2 rounded-full bg-zinc-900/80 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className={`ml-auto flex items-center gap-1 text-[11px] ${className}`}>
        <span>{symbol}</span>
        <span>{text}</span>
      </div>
    </div>
  );
};

type RiskBadgeProps = {
  flag: VitalsSnapshot["riskFlags"][number];
};

const RiskBadge: React.FC<RiskBadgeProps> = ({ flag }) => {
  const severityClass = (() => {
    switch (flag.severity) {
      case "high":
        return "border-red-500/70 bg-red-500/10 text-red-300";
      case "medium":
        return "border-amber-500/70 bg-amber-500/10 text-amber-300";
      case "low":
      default:
        return "border-zinc-600 bg-zinc-900/80 text-zinc-200";
    }
  })();

  return (
    <span
      className={`rounded-full border px-2 py-1 text-[10px] font-medium ${severityClass}`}
    >
      {flag.label}
    </span>
  );
};

/**
 * Helpers
 */

function horizonLabelFromKey(
  horizon: VitalsSnapshot["horizon"]
): string {
  switch (horizon) {
    case "today":
      return "Today";
    case "last_3_days":
      return "Last 3 days";
    case "last_7_days":
      return "Last 7 days";
    default:
      return horizon;
  }
}

function formatEnergy(energy: VitalsSnapshot["energy"]): string {
  switch (energy) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return energy;
  }
}

function formatFocus(focus: VitalsSnapshot["focus"]): string {
  switch (focus) {
    case "locked_in":
      return "Locked in";
    case "mixed":
      return "Mixed";
    case "scattered":
      return "Scattered";
    default:
      return focus;
  }
}

function trendDisplay(trend: "up" | "flat" | "down") {
  switch (trend) {
    case "up":
      return {
        symbol: "↗",
        text: "Improving",
        className: "text-emerald-300",
      };
    case "down":
      return {
        symbol: "↘",
        text: "Slipping",
        className: "text-red-300",
      };
    case "flat":
    default:
      return {
        symbol: "→",
        text: "Stable",
        className: "text-zinc-300",
      };
  }
}
