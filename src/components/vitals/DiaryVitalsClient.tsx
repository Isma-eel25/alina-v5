// src/components/vitals/DiaryVitalsClient.tsx

"use client";

import React, { useEffect, useState } from "react";
import type { VitalsSnapshot } from "@/lib/vitals";
import { VitalsPanel } from "./VitalsPanel";

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; vitals: VitalsSnapshot | null };

export const DiaryVitalsClient: React.FC = () => {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadVitals() {
      try {
        setState({ status: "loading" });
        const res = await fetch("/api/reflection", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!res.ok) {
          const body = await safeJson(res);
          if (!cancelled) {
            setState({
              status: "error",
              error:
                (body && typeof body.error === "string" && body.error) ||
                `Request failed with status ${res.status}`,
            });
          }
          return;
        }

        const data = await res.json();

        // Our GET /api/reflection returns either:
        //  - { message: "..."} if no vitals yet
        //  - or the VitalsSnapshot directly (per route.ts)
        const vitals: VitalsSnapshot | null =
          isVitalsSnapshot(data) ? data : null;

        if (!cancelled) {
          setState({ status: "success", vitals });
        }
      } catch (err: any) {
        if (!cancelled) {
          setState({
            status: "error",
            error:
              typeof err?.message === "string"
                ? err.message
                : "Unknown error while loading vitals",
          });
        }
      }
    }

    loadVitals();

    return () => {
      cancelled = true;
    };
  }, []);

  // 🔹 Loading / idle state
  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-300">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Alina Vitals
        </div>
        <div className="h-4 w-24 animate-pulse rounded-full bg-zinc-800" />
        <div className="mt-2 h-3 w-full animate-pulse rounded-full bg-zinc-900" />
      </div>
    );
  }

  // 🔹 Error state
  if (state.status === "error") {
    return (
      <div className="w-full rounded-xl border border-red-900 bg-red-950/60 p-4 text-sm text-red-200">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-400">
          Alina Vitals
        </div>
        <p className="text-[11px]">
          Could not load vitals:{" "}
          <span className="font-mono text-red-100">
            {state.error}
          </span>
        </p>
      </div>
    );
  }

  // 🔹 Success state
  // Here TS knows state.status === "success", so state.vitals is safe.
  return <VitalsPanel vitals={state.vitals} />;
};

/**
 * Helpers
 */

async function safeJson(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isVitalsSnapshot(data: any): data is VitalsSnapshot {
  if (!data || typeof data !== "object") return false;
  // Very light guard – just enough to avoid blowing up the UI
  return (
    typeof data.generatedAt === "string" &&
    typeof data.horizon === "string" &&
    typeof data.headline === "string" &&
    data.nextStep &&
    typeof data.nextStep.label === "string" &&
    typeof data.nextStep.detail === "string"
  );
}
