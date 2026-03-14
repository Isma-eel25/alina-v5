// src/lib/memory.ts
// 🔮 Alina Memory v0 – short-term memory helpers

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  // Optional timestamp so we can evolve later if needed
  createdAt?: string; // ISO string
}

/**
 * How many messages Alina should keep in "short-term memory".
 *
 * v0: very simple – just a fixed number of recent messages.
 * We can later upgrade this to be token-based instead of count-based.
 */
export const SHORT_TERM_MESSAGE_LIMIT = 16;

/**
 * Given the full list of messages from this session, return the slice
 * that should count as "short-term memory".
 *
 * - Assumes messages are in chronological order (oldest -> newest).
 * - Keeps only the last SHORT_TERM_MESSAGE_LIMIT messages.
 * - Filters out system messages for now (we'll inject system context separately).
 */
export function buildShortTermMemory(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || messages.length === 0) return [];

  // Filter out any weird/empty content to keep memory clean
  const cleaned = messages.filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0
  );

  if (cleaned.length <= SHORT_TERM_MESSAGE_LIMIT) {
    return cleaned;
  }

  return cleaned.slice(cleaned.length - SHORT_TERM_MESSAGE_LIMIT);
}

/**
 * Optional helper: serialize the short-term memory into a compact
 * text block we can stuff into a system/developer message.
 *
 * This is handy if we decide *not* to send the raw message list to the model
 * and instead give it a summarized memory chunk.
 *
 * For v0 we won't *require* this, but it's useful and low-cost to define now.
 */
export function serializeMemoryForPrompt(messages: ChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return "No recent context yet.";
  }

  const lines = messages.map((m) => {
    const prefix = m.role === "user" ? "User" : "Alina";
    // Keep it one line per message to avoid bloat
    const content = m.content.replace(/\s+/g, " ").trim();
    return `- ${prefix}: ${content}`;
  });

  return `Recent conversation (short-term memory):\n${lines.join("\n")}`;
}

/**
 * Tiny utility to help when we’re mapping from whatever
 * shape the frontend uses into this internal ChatMessage type.
 *
 * v0 NOTE: we support both `content` and `text` fields coming from the UI,
 * because the UI might be using `text` for the message body.
 */
export function toChatMessages(
  raw: Array<{ role: string; content?: string; text?: string; createdAt?: string }>
): ChatMessage[] {
  if (!raw) return [];

  return raw
    .map((m) => {
      // Prefer `content`, fall back to `text`
      const content =
        (m as any).content ??
        (m as any).text ??
        "";

      return {
        role: normalizeRole(m.role),
        content,
        createdAt: m.createdAt,
      };
    })
    .filter((m) => m.role === "user" || m.role === "assistant");
}

/**
 * Normalize any role strings we get from the UI/backend into
 * the strict ChatRole union.
 */
function normalizeRole(role: string | undefined): ChatRole {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
    case "alina":
    case "ai":
      return "assistant";
    case "system":
    default:
      return "system";
  }
}
