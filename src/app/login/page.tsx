"use client";

import { useMemo, useState } from "react";

type Mode = "login" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/alina";
    const params = new URLSearchParams(window.location.search);
    return params.get("next") ?? "/alina";
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint =
        mode === "login" ? "/api/auth/password/login" : "/api/auth/password/signup";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          next: nextPath,
          ...(mode === "signup" && inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };

      // Some endpoints may not return { ok: true } on success. Treat any 2xx as success unless ok === false.
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Auth failed. Please try again.");
        return;
      }

      // The API will set the session cookie. We can safely navigate to next.
      window.location.href = nextPath;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Alina</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {mode === "login"
              ? "Log in with email + password."
              : "Create an account with email + password."}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-neutral-100 p-1">
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              mode === "login" ? "bg-white shadow-sm" : "text-neutral-600"
            }`}
            onClick={() => {
              setMode("login");
              setInviteCode("");
            }}
            disabled={isSubmitting}
          >
            Log in
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              mode === "signup" ? "bg-white shadow-sm" : "text-neutral-600"
            }`}
            onClick={() => setMode("signup")}
            disabled={isSubmitting}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-800" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-neutral-800"
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              required
              minLength={8}
            />
          </div>

          {mode === "signup" && (
            <div>
              <label
                className="block text-sm font-medium text-neutral-800"
                htmlFor="inviteCode"
              >
                Invite code <span className="text-neutral-500">(optional)</span>
              </label>
              <input
                id="inviteCode"
                type="text"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                placeholder="WAITLIST150 (or PUBLIC250)"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                disabled={isSubmitting}
              />
              <p className="mt-1 text-xs text-neutral-500">
                If you’re on the waitlist, enter your code to unlock the waitlist price.
              </p>
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? mode === "login"
                ? "Logging in..."
                : "Creating account..."
              : mode === "login"
              ? "Log in"
              : "Create account"}
          </button>
        </form>

        {message && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </div>
        )}

        <div className="mt-6 text-xs text-neutral-500">
          By continuing, you agree to our terms. You can unsubscribe anytime.
        </div>
      </div>
    </div>
  );
}
