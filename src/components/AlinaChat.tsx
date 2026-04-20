"use client";

import { useState, useEffect, useRef, FormEvent, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { VitalsSnapshot } from "@/lib/vitals";
import { AlinaLocus, type LocusMode } from "@/components/AlinaLocus";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Role = "user" | "alina";

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  isStreaming?: boolean;
};

type ReflectionMemory = {
  id: string;
  createdAt: string;
  diary: string;
  vitals: VitalsSnapshot | null;
};

type UserProfileV1 = {
  summary: string;
  updatedAt: string;
};

type SessionV1 = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  diary: string | null;
  vitals: VitalsSnapshot | null;
  memories: ReflectionMemory[];
  userProfile: UserProfileV1 | null;
};

type FeedbackRating = "helpful" | "not_helpful";

type FeedbackDraft = {
  rating: FeedbackRating | null;
  comment: string;
  isSubmitting: boolean;
  isSubmitted: boolean;
  error: string | null;
  showCommentBox: boolean;
};

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================
// Sessions are scoped per user ID so different accounts never share localStorage data.
function getSessionsKey(userId: string) { return `alina_sessions_v2_${userId}`; }
function getActiveSessionKey(userId: string) { return `alina_active_session_id_v2_${userId}`; }

const REFLECT_DEBOUNCE_MS = 1800;
const REFLECT_COOLDOWN_MS = 25_000;
const REFLECT_MIN_TOTAL_MESSAGES = 4;
const REFLECT_NEW_MESSAGES_GATE = 4;

// Design System Colors
const THEME = {
  cyan: {
    400: "#22d3ee",
    500: "#06b6d4",
    600: "#0891b2",
    glow: "rgba(6, 182, 212, 0.5)",
    subtle: "rgba(6, 182, 212, 0.1)",
  },
  navy: {
    900: "#020617",
    800: "#0f172a",
    700: "#1e293b",
    600: "#334155",
  },
  surface: {
    primary: "rgba(15, 23, 42, 0.6)",
    elevated: "rgba(30, 41, 59, 0.8)",
    hover: "rgba(51, 65, 85, 0.5)",
  },
  text: {
    primary: "#f8fafc",
    secondary: "#94a3b8",
    tertiary: "#64748b",
    muted: "#475569",
  },
  gradient: {
    hero: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)",
    card: "linear-gradient(145deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.9) 100%)",
    glow: "radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.15) 0%, transparent 70%)",
  }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const isoNow = () => new Date().toISOString();
const makeId = (p: string) => `${p}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function getInitialFeedbackDraft(): FeedbackDraft {
  return {
    rating: null,
    comment: "",
    isSubmitting: false,
    isSubmitted: false,
    error: null,
    showCommentBox: false,
  };
}

function generateSessionTitleFromMessages(messages: Message[]): string {
  if (!messages || messages.length === 0) {
    return `New Chat`;
  }
  const firstUser = messages.find((m) => m.role === "user");
  const baseSource = firstUser?.content || messages[0].content || "";
  const cleaned = baseSource.replace(/\s+/g, " ").trim();
  if (!cleaned) return `New Chat`;
  const maxLen = 40;
  let title = cleaned;
  if (title.length > maxLen) {
    title = title.slice(0, maxLen).trimEnd() + "…";
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ============================================
// SSE TOKEN EXTRACTOR (Preserves Whitespace)
// ============================================
function extractTokenFromSSEDataLine(line: string): string {
  let raw = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
  raw = raw.replace(/\r$/, "");

  if (raw === "" || raw === "[DONE]") return "";

  const first = raw[0];
  if (first === "{" || first === "[") {
    try {
      const parsed: any = JSON.parse(raw);

      const delta =
        parsed?.choices?.[0]?.delta?.content ??
        parsed?.choices?.[0]?.delta?.text ??
        parsed?.choices?.[0]?.text ??
        parsed?.delta?.text ??
        parsed?.delta?.content ??
        parsed?.completion ??
        parsed?.token ??
        parsed?.content ??
        parsed?.message?.content;

      if (typeof delta === "string") return delta;
      if (typeof delta === "number" || typeof delta === "boolean") return String(delta);

      const parts = parsed?.choices?.[0]?.delta?.content;
      if (Array.isArray(parts)) {
        return parts
          .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
          .join("");
      }

      const anthropicParts = parsed?.content;
      if (Array.isArray(anthropicParts)) {
        return anthropicParts
          .map((p: any) => {
            if (typeof p?.text === "string") return p.text;
            if (typeof p?.content === "string") return p.content;
            return "";
          })
          .join("");
      }

      return "";
    } catch {
      return raw;
    }
  }

  return raw;
}

// ============================================
// MARKDOWN COMPONENTS
// ============================================
const MarkdownComponents = {
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";

    if (!inline && language) {
      return (
        <div className="relative group my-3 rounded-xl overflow-hidden border border-cyan-500/20 max-w-full">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-cyan-500/10">
            <span className="text-xs font-mono text-cyan-400">{language}</span>
            <button
              onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ""))}
              className="text-xs text-slate-400 hover:text-cyan-400 transition-colors"
            >
              Copy
            </button>
          </div>
          <div className="overflow-x-auto">
            <SyntaxHighlighter
              style={vscDarkPlus}
              language={language}
              PreTag="div"
              customStyle={{
                margin: 0,
                padding: "1rem",
                background: "rgba(2, 6, 23, 0.95)",
                fontSize: "0.8rem",
                lineHeight: "1.7",
                minWidth: 0,
              }}
              {...props}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          </div>
        </div>
      );
    }

    return (
      <code
        className="px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 font-mono text-[0.8em] border border-cyan-500/20 break-words"
        {...props}
      >
        {children}
      </code>
    );
  },

  p({ children }: any) {
    return <p className="mb-3 leading-relaxed text-slate-300 last:mb-0 break-words">{children}</p>;
  },

  h1({ children }: any) {
    return <h1 className="text-xl font-bold text-white mb-3 mt-5 border-b border-cyan-500/20 pb-2 break-words">{children}</h1>;
  },

  h2({ children }: any) {
    return <h2 className="text-lg font-semibold text-cyan-100 mb-2 mt-4 break-words">{children}</h2>;
  },

  h3({ children }: any) {
    return <h3 className="text-base font-medium text-cyan-200/90 mb-2 mt-3 break-words">{children}</h3>;
  },

  ul({ children }: any) {
    return <ul className="mb-3 space-y-1.5 ml-3">{children}</ul>;
  },

  ol({ children }: any) {
    return <ol className="mb-3 space-y-1.5 ml-3 list-decimal">{children}</ol>;
  },

  li({ children }: any) {
    return (
      <li className="flex items-start gap-2 text-slate-300">
        <span className="text-cyan-500 mt-1.5 flex-shrink-0">â€¢</span>
        <span className="leading-relaxed break-words min-w-0">{children}</span>
      </li>
    );
  },

  blockquote({ children }: any) {
    return (
      <blockquote className="border-l-2 border-cyan-500/50 pl-3 my-3 italic text-slate-400 bg-cyan-500/5 py-2 pr-3 rounded-r-lg break-words">
        {children}
      </blockquote>
    );
  },

  a({ href, children }: any) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors break-all"
      >
        {children}
      </a>
    );
  },

  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-3 rounded-xl border border-cyan-500/20 max-w-full">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },

  thead({ children }: any) {
    return <thead className="bg-slate-800/50 text-cyan-100">{children}</thead>;
  },

  th({ children }: any) {
    return <th className="px-3 py-2 text-left font-medium border-b border-cyan-500/20 whitespace-nowrap">{children}</th>;
  },

  td({ children }: any) {
    return <td className="px-3 py-2 border-b border-slate-700/50 text-slate-300">{children}</td>;
  },

  hr() {
    return <hr className="my-5 border-cyan-500/20" />;
  },
};

// ============================================
// UI COMPONENTS
// ============================================

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <div className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: "0ms" }} />
      <div className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: "150ms" }} />
      <div className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

function AlinaLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  return (
    <div className={`${sizeClasses[size]} relative flex-shrink-0`}>
      <div className="absolute inset-0 bg-cyan-500 rounded-lg blur-lg opacity-50 animate-pulse" />
      <div className="relative w-full h-full bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/25">
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5 text-white" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  icon,
  title,
  variant = "ghost",
  active = false
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  variant?: "ghost" | "primary" | "danger";
  active?: boolean;
}) {
  const variants = {
    ghost: `hover:bg-slate-800/50 text-slate-400 hover:text-cyan-400 ${active ? "bg-cyan-500/10 text-cyan-400" : ""}`,
    primary: "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/30",
    danger: "hover:bg-red-500/10 text-slate-400 hover:text-red-400",
  };

  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded-lg transition-all duration-200 ${variants[variant]}`}
    >
      {icon}
    </button>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function AlinaChat() {
  const [sessions, setSessions] = useState<SessionV1[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "index">("chat");
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [indexSidebarOpen, setIndexSidebarOpen] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [locusCollapsed, setLocusCollapsed] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, FeedbackDraft>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const sessionsRef = useRef<SessionV1[]>([]);
  const activeSessionIdRef = useRef<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const reflectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReflectAtRef = useRef<number>(0);
  const lastReflectMsgCountRef = useRef<number>(0);
  const reflectInFlightRef = useRef<boolean>(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const messages = activeSession?.messages ?? [];
  const memories = activeSession?.memories ?? [];
  const userProfile = activeSession?.userProfile ?? null;

  const totalMessageCount = useMemo(() =>
    sessions.reduce((acc, s) => acc + (s.messages?.length ?? 0), 0),
  [sessions]);

  const allMemories = useMemo(() =>
    sessions
      .flatMap((s) => s.memories ?? [])
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)),
  [sessions]);

  const locusMode = useMemo((): LocusMode => {
    if (!activeSession) return "calm";
    const hasStreaming = messages.some((m) => m.isStreaming);
    if (hasStreaming) return "intense";
    if (messages.length < 4) return "calm";
    const recent = messages.slice(-6);
    const wordCount = recent.reduce((acc, m) => acc + m.content.split(" ").length, 0);
    if (wordCount > 400) return "analytical";
    if (activeSession.diary) return "reflective";
    return "calm";
  }, [activeSession, messages]);

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);

  // â”€â”€ LOAD USER + USER-SCOPED SESSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        // Not logged in â€” redirect to login
        router.replace("/login");
        return;
      }

      setCurrentUserId(user.id);
      setUserEmail(user.email ?? null);

      const SESSIONS_KEY = getSessionsKey(user.id);
      const ACTIVE_KEY = getActiveSessionKey(user.id);

      try {
        const saved = localStorage.getItem(SESSIONS_KEY);
        const active = localStorage.getItem(ACTIVE_KEY);

        if (saved) {
          const parsed = JSON.parse(saved);
          const normalized = normalizeLoadedSessions(parsed);
          setSessions(normalized);

          if (active && normalized.some((s) => s.id === active)) {
            setActiveSessionId(active);
          } else if (normalized[0]) {
            setActiveSessionId(normalized[0].id);
          } else {
            createNewSessionForUser(user.id, true);
          }
        } else {
          createNewSessionForUser(user.id, true);
        }
      } catch {
        createNewSessionForUser(user.id, true);
      }
    };

    init();
  }, []);

  // On mobile, default sidebar to closed
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, []);

  // â”€â”€ PERSIST SESSIONS â€” scoped to user ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!currentUserId) return;
    if (sessions.length > 0) {
      localStorage.setItem(getSessionsKey(currentUserId), JSON.stringify(sessions));
    }
    if (activeSessionId) {
      localStorage.setItem(getActiveSessionKey(currentUserId), activeSessionId);
    }
  }, [sessions, activeSessionId, currentUserId]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (mode === "chat" && !showScrollButton) {
      scrollToBottom();
    }
  }, [messages, mode, showScrollButton]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Internal helper â€” creates session without needing currentUserId from state
  const createNewSessionForUser = useCallback((userId: string, silent?: boolean) => {
    const fresh: SessionV1 = {
      id: makeId("sess"),
      title: "New Chat",
      createdAt: isoNow(),
      updatedAt: isoNow(),
      messages: [],
      diary: null,
      vitals: null,
      memories: [],
      userProfile: null,
    };

    setSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    if (!silent) {
      setMode("chat");
      setSelectedMemoryId(null);
    }

    lastReflectAtRef.current = 0;
    lastReflectMsgCountRef.current = 0;
  }, []);

  const createNewSession = useCallback((silent?: boolean) => {
    if (currentUserId) {
      createNewSessionForUser(currentUserId, silent);
    }
  }, [currentUserId, createNewSessionForUser]);

  const deleteSession = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (id === activeSessionId && filtered.length > 0) {
        setActiveSessionId(filtered[0].id);
        setSelectedMemoryId(null);
      } else if (filtered.length === 0) {
        createNewSession(true);
      }
      return filtered;
    });
  }, [activeSessionId, createNewSession]);

  const updateActiveSession = useCallback((patch: Partial<SessionV1>) => {
    const id = activeSessionIdRef.current;
    if (!id) return;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, ...patch, updatedAt: isoNow() } : s
      )
    );
  }, []);

  const getActiveSessionLive = useCallback((): SessionV1 | null => {
    const id = activeSessionIdRef.current;
    if (!id) return null;
    return sessionsRef.current.find((s) => s.id === id) || null;
  }, []);

  // â”€â”€ LOGOUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
      router.replace("/login");
    } catch {
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, router, supabase]);

  const patchFeedbackDraft = useCallback((messageId: string, patch: Partial<FeedbackDraft>) => {
    setFeedbackByMessageId((prev) => ({
      ...prev,
      [messageId]: {
        ...(prev[messageId] ?? getInitialFeedbackDraft()),
        ...patch,
      },
    }));
  }, []);

  const submitFeedback = useCallback(async (
    messageId: string,
    rating: FeedbackRating,
    comment?: string,
  ) => {
    patchFeedbackDraft(messageId, {
      rating,
      isSubmitting: true,
      error: null,
      showCommentBox: rating === "not_helpful",
    });

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageId,
          rating,
          comment: comment?.trim() ? comment.trim() : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : `Feedback error: ${res.status}`);
      }

      patchFeedbackDraft(messageId, {
        rating,
        comment: comment ?? "",
        isSubmitting: false,
        isSubmitted: true,
        error: null,
        showCommentBox: false,
      });
    } catch (error) {
      patchFeedbackDraft(messageId, {
        isSubmitting: false,
        isSubmitted: false,
        error: error instanceof Error ? error.message : "Could not save feedback.",
      });
    }
  }, [patchFeedbackDraft]);

  const handleHelpfulClick = useCallback(async (messageId: string) => {
    const draft = feedbackByMessageId[messageId] ?? getInitialFeedbackDraft();
    if (draft.isSubmitting || draft.isSubmitted) return;
    await submitFeedback(messageId, "helpful");
  }, [feedbackByMessageId, submitFeedback]);

  const handleNotHelpfulClick = useCallback((messageId: string) => {
    const draft = feedbackByMessageId[messageId] ?? getInitialFeedbackDraft();
    if (draft.isSubmitting || draft.isSubmitted) return;

    patchFeedbackDraft(messageId, {
      rating: "not_helpful",
      showCommentBox: true,
      error: null,
    });
  }, [feedbackByMessageId, patchFeedbackDraft]);

  const handleFeedbackCommentChange = useCallback((messageId: string, comment: string) => {
    patchFeedbackDraft(messageId, { comment, error: null });
  }, [patchFeedbackDraft]);

  const handleFeedbackSubmit = useCallback(async (messageId: string) => {
    const draft = feedbackByMessageId[messageId] ?? getInitialFeedbackDraft();
    if (draft.isSubmitting || draft.isSubmitted) return;
    await submitFeedback(messageId, "not_helpful", draft.comment);
  }, [feedbackByMessageId, submitFeedback]);

  const handleFeedbackSkipComment = useCallback(async (messageId: string) => {
    const draft = feedbackByMessageId[messageId] ?? getInitialFeedbackDraft();
    if (draft.isSubmitting || draft.isSubmitted) return;
    await submitFeedback(messageId, "not_helpful", "");
  }, [feedbackByMessageId, submitFeedback]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmedInput = input.trim();
    if ((!trimmedInput && !attachedFile) || isSending || !activeSessionIdRef.current) return;

    setInput("");
    setIsSending(true);

    const fileBlock = attachedFile
      ? `\n\n\`\`\`${attachedFile.name.split(".").pop() ?? "txt"}\n// ${attachedFile.name}\n${attachedFile.content}\n\`\`\``
      : "";
    const fullContent = (trimmedInput + fileBlock).trim();
    setAttachedFile(null);

    const userM: Message = {
      id: makeId("u"),
      role: "user",
      content: fullContent,
      createdAt: isoNow(),
    };

    const aiM: Message = {
      id: makeId("a"),
      role: "alina",
      content: "",
      createdAt: isoNow(),
      isStreaming: true,
    };

    const nextMsgs = [...messages, userM, aiM];
    updateActiveSession({ messages: nextMsgs });
    setFeedbackByMessageId((prev) => {
      if (prev[aiM.id]) return prev;
      return { ...prev, [aiM.id]: getInitialFeedbackDraft() };
    });

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    try {
      const sessLive = getActiveSessionLive();

      const res = await fetch("/api/brain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        cache: "no-store",
        body: JSON.stringify({
          messages: [...messages, userM].map((m) => ({
            role: m.role === "user" ? ("user" as const) : ("assistant" as const),
            content: m.content,
            createdAt: m.createdAt,
          })),
          reflectionSummary: sessLive?.diary ?? null,
          vitalsSnapshot: sessLive?.vitals ?? null,
          userProfileSummary: sessLive?.userProfile?.summary ?? null,
        }),
      });

      // Session expired â€” redirect to login
      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      if (res.status === 402) {
        setShowUpgrade(true);
        updateActiveSession({
          messages: nextMsgs.map((m) =>
            m.id === aiM.id
              ? { ...m, content: "🔒 Upgrade required to continue. Tap **Upgrade** to unlock full access.", isStreaming: false }
              : m
          ),
        });
        return;
      }

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      setShowUpgrade(false);

      const ctype = res.headers.get("content-type") || "";

      if (!res.body || ctype.includes("application/json")) {
        const data = await res.json().catch(() => null);
        const rawText = data?.content ?? data?.reply ?? data?.message ?? data?.text;
        const text = typeof rawText === "string" ? rawText : rawText != null ? String(rawText) : "Error processing response";

        updateActiveSession({
          messages: nextMsgs.map((m) =>
            m.id === aiM.id ? { ...m, content: text, isStreaming: false } : m
          ),
        });
        scheduleReflectIfEligible(nextMsgs.length);
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let full = "";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += value;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        let appendedThisTick = "";
        for (const frame of frames) {
          const lines = frame.split("\n");
          for (const line of lines) {
            if (line.startsWith("data:")) {
              const token = extractTokenFromSSEDataLine(line);
              if (token !== "") appendedThisTick += token;
            }
          }
        }

        if (appendedThisTick) {
          full += appendedThisTick;
          updateActiveSession({
            messages: nextMsgs.map((m) =>
              m.id === aiM.id ? { ...m, content: full, isStreaming: true } : m
            ),
          });
        }
      }

      if (buffer.includes("data:")) {
        const lines = buffer.split("\n");
        let tail = "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const token = extractTokenFromSSEDataLine(line);
            if (token !== "") tail += token;
          }
        }
        if (tail) {
          full += tail;
          updateActiveSession({
            messages: nextMsgs.map((m) =>
              m.id === aiM.id ? { ...m, content: full, isStreaming: false } : m
            ),
          });
        }
      }

      updateActiveSession({
        messages: nextMsgs.map((m) =>
          m.id === aiM.id ? { ...m, content: full, isStreaming: false } : m
        ),
      });

      scheduleReflectIfEligible(nextMsgs.length);

      if (messages.length <= 2) {
        const title = generateSessionTitleFromMessages([...nextMsgs.slice(0, -1), { ...aiM, content: full }]);
        updateActiveSession({ title });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error occurred";
      updateActiveSession({
        messages: nextMsgs.map((m) =>
          m.id === aiM.id
            ? { ...m, content: `**Error:** ${errorMsg}\n\nPlease try again.`, isStreaming: false }
            : m
        ),
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const shouldTriggerReflect = (msgCount: number) => {
    const now = Date.now();
    if (reflectInFlightRef.current) return false;
    if (msgCount < REFLECT_MIN_TOTAL_MESSAGES) return false;
    const sinceLast = msgCount - lastReflectMsgCountRef.current;
    if (sinceLast < REFLECT_NEW_MESSAGES_GATE) return false;
    const cooledDown = now - lastReflectAtRef.current >= REFLECT_COOLDOWN_MS;
    return cooledDown;
  };

  const callReflectForActiveSession = async () => {
    const sess = getActiveSessionLive();
    if (!sess || reflectInFlightRef.current) return;

    const msgCount = sess.messages.length;
    if (!shouldTriggerReflect(msgCount)) return;

    reflectInFlightRef.current = true;

    try {
      const reflectMessages = sess.messages.map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
        createdAt: m.createdAt,
      }));

      const res = await fetch("/api/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: reflectMessages,
          vitalsSummary: sess.vitals ? JSON.stringify(sess.vitals) : null,
        }),
      });

      if (!res.ok) return;

      const data = await res.json();
      console.log("[ALINA REFLECT]", { diary: !!data.diary, profile: !!data.userProfileSummary, vitals: data.vitalsSnapshot });
      const createdAt = data.createdAt || data.timestamp || isoNow();
      const diary = typeof data.diary === "string" ? data.diary : "";
      const userProfileSummary = typeof data.userProfileSummary === "string" ? data.userProfileSummary : "";

      const incomingVitals = data.vitalsSnapshot ? ({ ...data.vitalsSnapshot } as any) : null;
      if (!diary && !userProfileSummary && !incomingVitals) return;

      const id = activeSessionIdRef.current;

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;

          const existing = safeArray<ReflectionMemory>(s.memories);
          const already = existing.some((m) => m.createdAt === createdAt);

          const updates: Partial<SessionV1> = { updatedAt: isoNow() };

          if (diary || incomingVitals) {
            if (diary) updates.diary = diary;
            updates.vitals = incomingVitals;
          }

          if (userProfileSummary) {
            updates.userProfile = {
              summary: userProfileSummary,
              updatedAt: createdAt,
            };
          }

          if (already || !diary) {
            return { ...s, ...updates };
          }

          const entry: ReflectionMemory = {
            id: makeId("mem"),
            createdAt,
            diary,
            vitals: incomingVitals,
          };

          return { ...s, ...updates, memories: [entry, ...existing] };
        })
      );

      lastReflectAtRef.current = Date.now();
      lastReflectMsgCountRef.current = msgCount;
    } finally {
      reflectInFlightRef.current = false;
    }
  };

  const scheduleReflectIfEligible = (msgCount: number) => {
    if (!shouldTriggerReflect(msgCount)) return;
    if (reflectDebounceRef.current) clearTimeout(reflectDebounceRef.current);
    reflectDebounceRef.current = setTimeout(() => {
      void callReflectForActiveSession();
    }, REFLECT_DEBOUNCE_MS);
  };

  if (!activeSession && sessions.length > 0) return null;

  return (
    <div className="flex h-[100dvh] w-full bg-[#020617] text-slate-100 font-sans overflow-hidden selection:bg-cyan-500/30">
      {showUpgrade && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-[min(92vw,620px)] rounded-2xl border border-yellow-400/25 bg-yellow-400/10 px-4 py-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-yellow-100/90">
              🔒 You've hit the paywall. Upgrade to keep chatting with Alina.
            </div>
            <button
              type="button"
              onClick={() => router.push("/upgrade")}
              className="shrink-0 rounded-xl bg-yellow-300 px-3 py-2 text-xs font-semibold text-black hover:opacity-90"
            >
              Upgrade
            </button>
          </div>
        </div>
      )}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        * {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(6, 182, 212, 0.2);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(6, 182, 212, 0.4);
        }

        .glass-panel {
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(6, 182, 212, 0.1);
        }

        .message-enter {
          animation: messageSlide 0.3s ease-out forwards;
        }

        @keyframes messageSlide {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .glow-text {
          text-shadow: 0 0 20px rgba(6, 182, 212, 0.5);
        }

        .gradient-border {
          position: relative;
        }
        .gradient-border::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, rgba(6, 182, 212, 0.5), transparent, rgba(6, 182, 212, 0.3));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }

        @media (max-width: 767px) {
          .mobile-no-overflow {
            overflow-x: hidden;
            max-width: 100vw;
          }
        }
      `}</style>

      {/* â”€â”€ MOBILE OVERLAY â”€â”€ */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* â”€â”€ SIDEBAR â”€â”€ Desktop: static | Mobile: drawer */}
      <aside
        className={`
          flex flex-col border-r border-cyan-500/10 bg-[#0f172a]/95 backdrop-blur-xl
          transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 md:z-auto
          fixed inset-y-0 left-0 z-40
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          w-72
          md:transition-all md:duration-300
          ${!sidebarOpen ? "md:w-0 md:opacity-0 md:overflow-hidden md:border-0" : "md:opacity-100 md:w-72"}
        `}
      >
        <div className="p-4 border-b border-cyan-500/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <AlinaLogo size="sm" />
              <div>
                <h1 className="font-bold text-lg tracking-tight">Alina</h1>
                <p className="text-xs text-cyan-400/70">v5.0 Neural Interface</p>
              </div>
            </div>
            {/* Close button â€” mobile only */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800/50 transition-colors"
              aria-label="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <button
            onClick={() => createNewSession()}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => {
                setActiveSessionId(s.id);
                setSelectedMemoryId(null);
                if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
              }}
              className={`group relative p-3 rounded-xl cursor-pointer transition-all duration-200 ${
                s.id === activeSessionId
                  ? "bg-cyan-500/10 border border-cyan-500/30"
                  : "hover:bg-slate-800/50 border border-transparent"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${s.id === activeSessionId ? "bg-cyan-400" : "bg-slate-600"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${s.id === activeSessionId ? "text-cyan-100" : "text-slate-300"}`}>
                    {s.title}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatRelativeTime(s.updatedAt)}
                  </p>
                </div>
              </div>

              <button
                onClick={(e) => deleteSession(e, s.id)}
                className="absolute right-2 top-2 p-1.5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* â”€â”€ SIDEBAR FOOTER: user info + logout â”€â”€ */}
        <div className="p-4 border-t border-cyan-500/10 space-y-3">
          {userEmail && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="text-xs text-slate-400 truncate">{userEmail}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>System Operational</span>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
              title="Sign out"
            >
              {isLoggingOut ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              )}
              {isLoggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        </div>

        {/* â”€â”€ HEADER â”€â”€ */}
        <header className="h-14 md:h-16 border-b border-cyan-500/10 flex items-center justify-between px-3 md:px-4 bg-[#0f172a]/50 backdrop-blur-xl z-20 flex-shrink-0">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-slate-800/50 rounded-lg text-slate-400 hover:text-cyan-400 transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div className="flex items-center gap-0.5 md:gap-1 bg-slate-800/50 rounded-lg p-1 flex-shrink-0">
              <button
                onClick={() => setMode("chat")}
                className={`px-3 md:px-4 py-1.5 rounded-md text-xs md:text-sm font-medium transition-all ${
                  mode === "chat"
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setMode("index")}
                className={`px-3 md:px-4 py-1.5 rounded-md text-xs md:text-sm font-medium transition-all ${
                  mode === "index"
                    ? "bg-purple-500/20 text-purple-400"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Index
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            {mode === "chat" && activeSession && (
              <span className="text-xs md:text-sm text-slate-500 hidden sm:block">
                {messages.length} messages
              </span>
            )}
            {mode === "index" && (
              <button
                onClick={() => setIndexSidebarOpen(!indexSidebarOpen)}
                className="p-2 hover:bg-slate-800/50 rounded-lg text-slate-400 hover:text-purple-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
          </div>
        </header>

        <div className="hidden md:block">
        <AlinaLocus
          mode={locusMode}
          sessionCount={sessions.length}
          messageCount={messages.length}
          totalMessageCount={totalMessageCount}
          memories={allMemories}
          userProfile={userProfile?.summary ?? null}
          isStreaming={messages.some((m) => m.isStreaming)}
          lastUpdated={
            activeSession?.updatedAt
              ? new Date(activeSession.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : null
          }
          vitals={
            activeSession?.vitals
              ? (() => {
                  const v = activeSession.vitals as any;
                  const toBar = (x: unknown) => {
                    if (typeof x === "number") return Math.round(Math.min(x <= 1 ? x * 100 : x, 100));
                    const strMap: Record<string, number> = {
                      very_low: 5, low: 20, low_moderate: 30, moderate: 40,
                      neutral: 50, neutral_technical: 50, moderate_high: 60,
                      high: 80, very_high: 95,
                      frustrated_but_focused: 65, focused: 75, engaged: 70,
                      disengaged: 25, overwhelmed: 20, calm: 55, excited: 85,
                    };
                    return strMap[String(x).toLowerCase()] ?? 50;
                  };
                  const moodMap: Record<string, number> = {
                    very_low: 5, low: 25, neutral: 50, good: 75, high: 95,
                  };
                  const rawMood = v.mood ?? v.emotionalState ?? v.emotional_state ?? "neutral";
                  const moodLabel = String(rawMood).replace(/_/g, " ");
                  return {
                    mood:       moodMap[String(v.mood ?? "neutral")] ?? toBar(rawMood),
                    energy:     toBar(v.energy ?? v.energyLevel ?? v.energy_level),
                    focus:      toBar(v.focus ?? v.focusLevel ?? v.focus_level),
                    clarity:    toBar(v.clarity ?? v.clarityLevel ?? v.clarity_level),
                    confidence: toBar(v.confidence ?? v.confidenceLevel ?? v.confidence_level ?? v.trustLevel ?? v.trust_level),
                    moodLabel,
                  };
                })()
              : undefined
          }
        />
        </div>

        <div className="flex-1 overflow-hidden relative min-h-0">
          {mode === "chat" ? (
            <div className="h-full flex flex-col">
              {/* â”€â”€ MESSAGE LIST â”€â”€ */}
              <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-3 py-3 md:p-4 space-y-3 min-h-0"
              >
                {messages.map((m, idx) => {
                  const isUser = m.role === "user";
                  const feedbackDraft = !isUser ? (feedbackByMessageId[m.id] ?? getInitialFeedbackDraft()) : null;
                  const showFeedbackControls = !isUser && !m.isStreaming && m.content.trim().length > 0 && !m.content.startsWith("**Error:**");

                  return (
                    <div
                      key={m.id}
                      className={`message-enter flex ${isUser ? "justify-end" : "justify-start"}`}
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className={`flex gap-1.5 md:gap-2 w-full max-w-[90%] md:max-w-[85%] lg:max-w-[75%] ${isUser ? "flex-row-reverse ml-auto" : "mr-auto"}`}>
                        <div className="flex-shrink-0 mt-1">
                          {isUser ? (
                            <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-slate-700 flex items-center justify-center">
                              <svg className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                          ) : (
                            <AlinaLogo size="sm" />
                          )}
                        </div>

                        <div className={`flex flex-col min-w-0 flex-1 ${isUser ? "items-end" : "items-start"}`}>
                          <div
                            className={`px-3.5 py-3 md:px-5 md:py-3.5 rounded-2xl max-w-full min-w-0 ${
                              isUser
                                ? "bg-cyan-600 text-white rounded-br-md"
                                : "glass-panel text-slate-200 rounded-bl-md"
                            }`}
                          >
                            {m.isStreaming && !m.content ? (
                              <ThinkingIndicator />
                            ) : (
                              <div className={`prose prose-invert max-w-none text-sm md:text-base break-words overflow-hidden ${isUser ? "prose-p:text-white prose-strong:text-white" : ""}`}>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[rehypeKatex]}
                                  components={MarkdownComponents}
                                >
                                  {m.content}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>

                          <span className="text-[10px] text-slate-500 mt-1 px-1">
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>

                          {showFeedbackControls && feedbackDraft && (
                            <div className="mt-2 w-full rounded-xl border border-cyan-500/10 bg-slate-900/40 px-2.5 py-2 md:px-3">
                              <div className="flex flex-wrap items-center gap-1.5 md:gap-2 text-xs text-slate-400">
                                <span className="text-slate-500">Was this helpful?</span>
                                <button
                                  type="button"
                                  onClick={() => void handleHelpfulClick(m.id)}
                                  disabled={feedbackDraft.isSubmitting || feedbackDraft.isSubmitted}
                                  className={`rounded-lg border px-2 py-1 transition-colors ${
                                    feedbackDraft.rating === "helpful"
                                      ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-300"
                                      : "border-slate-700 text-slate-300 hover:border-cyan-500/30 hover:text-cyan-300"
                                  } disabled:cursor-not-allowed disabled:opacity-70`}
                                >
                                  👍 Helpful
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleNotHelpfulClick(m.id)}
                                  disabled={feedbackDraft.isSubmitting || feedbackDraft.isSubmitted}
                                  className={`rounded-lg border px-2 py-1 transition-colors ${
                                    feedbackDraft.rating === "not_helpful" || feedbackDraft.showCommentBox
                                      ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
                                      : "border-slate-700 text-slate-300 hover:border-amber-500/30 hover:text-amber-300"
                                  } disabled:cursor-not-allowed disabled:opacity-70`}
                                >
                                  👎 Not Helpful
                                </button>
                                {feedbackDraft.isSubmitting && (
                                  <span className="text-cyan-400">Saving…</span>
                                )}
                                {feedbackDraft.isSubmitted && (
                                  <span className="text-green-400">Saved ✓</span>
                                )}
                              </div>

                              {feedbackDraft.showCommentBox && !feedbackDraft.isSubmitted && (
                                <div className="mt-2.5 space-y-2">
                                  <textarea
                                    value={feedbackDraft.comment}
                                    onChange={(e) => handleFeedbackCommentChange(m.id, e.target.value)}
                                    placeholder="Optional: what was off, missing, or unhelpful?"
                                    rows={3}
                                    className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-500/40"
                                    disabled={feedbackDraft.isSubmitting}
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleFeedbackSubmit(m.id)}
                                      disabled={feedbackDraft.isSubmitting}
                                      className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                      Send feedback
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleFeedbackSkipComment(m.id)}
                                      disabled={feedbackDraft.isSubmitting}
                                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                      Skip comment
                                    </button>
                                  </div>
                                </div>
                              )}

                              {feedbackDraft.error && (
                                <p className="mt-2 text-xs text-red-400">{feedbackDraft.error}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* â”€â”€ SCROLL TO BOTTOM BUTTON â”€â”€ */}
              {showScrollButton && (
                <button
                  onClick={scrollToBottom}
                  className="absolute bottom-24 right-4 md:right-6 p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-full shadow-lg border border-cyan-500/20 transition-all z-10"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </button>
              )}

              {/* â”€â”€ INPUT AREA â”€â”€ */}
              <div className="flex-shrink-0 px-3 pb-3 pt-2 md:p-4 bg-gradient-to-t from-[#020617] via-[#020617]/95 to-transparent">
                <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
                  {attachedFile && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-xs text-cyan-300 max-w-full overflow-hidden">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="font-mono truncate">{attachedFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachedFile(null)}
                          className="ml-1 text-slate-400 hover:text-red-400 transition-colors flex-shrink-0"
                        >
                          Ã—
                        </button>
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.ts,.tsx,.js,.jsx,.py,.json,.md,.css,.html,.csv,.sh,.env,.yaml,.yml,.toml,.rs,.go,.java,.c,.cpp,.h"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const content = ev.target?.result as string;
                        setAttachedFile({ name: file.name, content });
                      };
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                  <div className="relative flex items-end gap-1.5 md:gap-2 bg-slate-800/50 backdrop-blur-xl border border-cyan-500/20 rounded-2xl p-2 focus-within:border-cyan-500/50 focus-within:shadow-lg focus-within:shadow-cyan-500/10 transition-all">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Message Alina..."
                      rows={1}
                      className="flex-1 bg-transparent px-2 py-2.5 md:px-4 md:py-3 outline-none text-sm text-slate-100 placeholder:text-slate-500 resize-none max-h-40 md:max-h-52 custom-scrollbar min-w-0"
                      disabled={isSending}
                    />

                    <div className="flex items-center gap-0.5 md:gap-1 pb-1 pr-0.5 md:pr-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={`p-2 rounded-lg hover:bg-cyan-500/10 transition-colors ${attachedFile ? "text-cyan-400" : "text-slate-400 hover:text-cyan-400"}`}
                        title="Attach text or code file"
                      >
                        <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </button>

                      <button
                        type="submit"
                        disabled={isSending || (!input.trim() && !attachedFile)}
                        className="p-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 rounded-xl transition-all duration-200 shadow-lg shadow-cyan-500/20 disabled:shadow-none"
                      >
                        {isSending ? (
                          <svg className="w-4 h-4 md:w-5 md:h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto custom-scrollbar">
              <div className="max-w-2xl mx-auto p-3 md:p-6 space-y-4">
                {userProfile && (
                  <div className="glass-panel rounded-2xl p-4 md:p-5 gradient-border">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">Profile</span>
                      <span className="text-[10px] text-slate-500">{formatRelativeTime(userProfile.updatedAt)}</span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none text-slate-300 break-words">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                        {userProfile.summary}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {memories.length > 0 ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 px-1">
                      {memories.length} {memories.length === 1 ? "memory" : "memories"}
                    </p>
                    {memories.map((m) => (
                      <div
                        key={m.id}
                        className={`group glass-panel rounded-2xl p-4 md:p-5 cursor-pointer transition-all duration-200 ${
                          selectedMemoryId === m.id
                            ? "border-cyan-500/30 bg-cyan-500/5"
                            : "hover:border-slate-600/50"
                        }`}
                        onClick={() => setSelectedMemoryId(selectedMemoryId === m.id ? null : m.id)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-mono text-slate-400 break-words">
                            {new Date(m.createdAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessions((prev) =>
                                prev.map((s) =>
                                  s.id === activeSessionId
                                    ? { ...s, memories: s.memories.filter((mem) => mem.id !== m.id), updatedAt: isoNow() }
                                    : s
                                )
                              );
                              if (selectedMemoryId === m.id) setSelectedMemoryId(null);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all rounded flex-shrink-0 ml-2"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {selectedMemoryId === m.id ? (
                          <div className="prose prose-invert prose-sm max-w-none text-slate-300 message-enter break-words">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                              {m.diary}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400 line-clamp-3 leading-relaxed break-words">{m.diary}</p>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  !userProfile && (
                    <div className="text-center py-24 text-slate-600">
                      <div className="w-12 h-12 mx-auto mb-4 rounded-full border border-slate-700 flex items-center justify-center">
                        <svg className="w-5 h-5 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-sm">Nothing here yet.</p>
                      <p className="text-xs mt-1 text-slate-700">Memories build as you chat.</p>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function normalizeLoadedSessions(raw: any): SessionV1[] {
  const arr = safeArray<any>(raw);
  const now = isoNow();

  return arr
    .map((s: any): SessionV1 => {
      const messagesRaw = safeArray<any>(s?.messages);
      const messages: Message[] = messagesRaw.map((m: any): Message => {
        let content = typeof m?.content === "string" ? m.content : "";
        if (
          m?.role !== "user" &&
          (content.includes("Neural interface initialized") || content.includes("I'm Alina, your AI companion"))
        ) {
          content = "Alina V5 here.";
        }
        return {
          id: typeof m?.id === "string" ? m.id : makeId("m"),
          role: m?.role === "user" ? "user" : "alina",
          content,
          createdAt: typeof m?.createdAt === "string" ? m.createdAt : now,
          isStreaming: false,
        };
      });

      const memoriesRaw = safeArray<any>(s?.memories);
      const memories: ReflectionMemory[] = memoriesRaw.map((m: any) => ({
        id: typeof m?.id === "string" ? m.id : makeId("mem"),
        createdAt: typeof m?.createdAt === "string" ? m.createdAt : now,
        diary: typeof m?.diary === "string" ? m.diary : "",
        vitals: m?.vitals ?? null,
      }));

      const userProfile: UserProfileV1 | null =
        typeof s?.userProfile?.summary === "string" && s.userProfile.summary.trim()
          ? {
              summary: s.userProfile.summary,
              updatedAt: s.userProfile.updatedAt || now,
            }
          : null;

      return {
        id: typeof s?.id === "string" ? s.id : makeId("sess"),
        title: typeof s?.title === "string" ? s.title : "New Chat",
        createdAt: typeof s?.createdAt === "string" ? s.createdAt : now,
        updatedAt: typeof s?.updatedAt === "string" ? s.updatedAt : now,
        messages: messages,
        diary: typeof s?.diary === "string" ? s.diary : null,
        vitals: s?.vitals ?? null,
        memories,
        userProfile,
      };
    })
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
}

