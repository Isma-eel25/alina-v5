// src/lib/creationEngine.ts
// Alina v∞ — Creation Engine v10: Experience Graph Foundation
// This module stays PURE and side-effect-free. No DB, no prompt wiring,
// no memory writes. It only shapes a read-only experience graph structure
// from upstream engine summaries.

import type {
  CreationEngineV10ScaffoldInput,
  StatisticalSelfStudySummary,
} from "./statisticalSelfStudy";

export type CreationIntent =
  | "brainstorm"
  | "deep_analysis"
  | "execution_plan"
  | "narrative"
  | "message"
  | "question_refinement";

export interface CreationEngineInput {
  nowISO: string;
  intent: CreationIntent;
  userGoalSummary?: string;

  // Loose summaries from other engines — all plain strings:
  personalitySummary?: string;
  personaSummary?: string;
  vitalsSummary?: string;
  executionDirectiveLabel?: string;
  executionDirectiveMode?: string;
  statisticalHeadline?: string;
  statisticalDetails?: string[];
  reflectionHeadlines?: string[];
}

/**
 * A single node in the internal experience graph.
 * This is intentionally generic and JSON-serializable.
 */
export interface ExperienceGraphNode {
  id: string;
  type:
    | "state_snapshot"
    | "execution_bias"
    | "reflection"
    | "statistical_summary";
  label: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * A simple directed edge between experience nodes.
 */
export interface ExperienceGraphEdge {
  from: string;
  to: string;
  relation: "co_occurs_with" | "follows" | "related_to";
  weight?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Read-only experience graph object built per-turn from the
 * Creation Engine v10 scaffold input.
 *
 * This structure is INTERNAL ONLY for now:
 * - not exposed to the user
 * - not wired into prompts
 * - not written into memory
 */
export interface ExperienceGraph {
  version: "v10-experience-graph-1";
  userId?: string;
  sessionId: string;
  timestamp: string;

  // Clinical vitals snapshot (already low-cardinality labels)
  mood: string;
  stress: string;
  focus: string;
  energy: string;

  executionBiasTag?: string;
  reflectionHeadline?: string;
  statisticalSummary: StatisticalSelfStudySummary | null;

  nodes: ExperienceGraphNode[];
  edges: ExperienceGraphEdge[];
  tags: string[];
}

/**
 * Build a per-turn, read-only ExperienceGraph from a scaffold object.
 * This function MUST remain pure and safe: no side effects, no I/O.
 */
export function buildExperienceGraphFromScaffold(
  scaffold: CreationEngineV10ScaffoldInput,
): ExperienceGraph {
  const {
    userId,
    sessionId,
    timestamp,
    clinicalVitals,
    executionBiasTag,
    reflectionHeadline,
    statisticalSummary,
  } = scaffold;

  const baseId = `${sessionId}:${timestamp}`;

  const nodes: ExperienceGraphNode[] = [];

  // Core state snapshot node
  const vitalsNodeId = `${baseId}:vitals`;
  nodes.push({
    id: vitalsNodeId,
    type: "state_snapshot",
    label: "Clinical vitals snapshot",
    timestamp,
    metadata: {
      mood: clinicalVitals.mood,
      stress: clinicalVitals.stress,
      focus: clinicalVitals.focus,
      energy: clinicalVitals.energy,
    },
  });

  // Execution bias node (if present)
  let executionNodeId: string | null = null;
  if (executionBiasTag) {
    executionNodeId = `${baseId}:execution`;
    nodes.push({
      id: executionNodeId,
      type: "execution_bias",
      label: `Execution bias: ${executionBiasTag}`,
      timestamp,
      metadata: {
        executionBiasTag,
      },
    });
  }

  // Reflection headline node (if present)
  let reflectionNodeId: string | null = null;
  if (reflectionHeadline) {
    reflectionNodeId = `${baseId}:reflection`;
    nodes.push({
      id: reflectionNodeId,
      type: "reflection",
      label: reflectionHeadline,
      timestamp,
    });
  }

  // Statistical summary node (if present)
  let statsNodeId: string | null = null;
  if (statisticalSummary) {
    statsNodeId = `${baseId}:stats`;
    nodes.push({
      id: statsNodeId,
      type: "statistical_summary",
      label: "Statistical self-study snapshot",
      timestamp,
      metadata: {
        statisticalSummary,
      },
    });
  }

  const edges: ExperienceGraphEdge[] = [];

  // Simple co-occurrence edges from vitals node to other nodes
  for (const node of nodes) {
    if (node.id === vitalsNodeId) continue;
    edges.push({
      from: vitalsNodeId,
      to: node.id,
      relation: "co_occurs_with",
      metadata: {
        timestamp,
      },
    });
  }

  const tags: string[] = [
    `mood:${clinicalVitals.mood}`,
    `stress:${clinicalVitals.stress}`,
    `focus:${clinicalVitals.focus}`,
    `energy:${clinicalVitals.energy}`,
  ];

  if (executionBiasTag) {
    tags.push(`executionBias:${executionBiasTag}`);
  }
  if (reflectionHeadline) {
    tags.push("hasReflection");
  }
  if (statisticalSummary) {
    tags.push("hasStatisticalSummary");
  }

  return {
    version: "v10-experience-graph-1",
    userId,
    sessionId,
    timestamp,
    mood: clinicalVitals.mood,
    stress: clinicalVitals.stress,
    focus: clinicalVitals.focus,
    energy: clinicalVitals.energy,
    executionBiasTag: executionBiasTag ?? undefined,
    reflectionHeadline: reflectionHeadline ?? undefined,
    statisticalSummary,
    nodes,
    edges,
    tags,
  };
}