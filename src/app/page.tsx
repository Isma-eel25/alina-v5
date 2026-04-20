"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) return;
    const next = searchParams.get("next") ?? "/alina";
    const callbackUrl = `/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`;
    router.replace(callbackUrl);
  }, [router, searchParams]);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-12">
        <div className="mx-auto w-full max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1 text-sm text-slate-300">
            Alina Labs
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Alina
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            The companion that closes the Execution–Emotion Gap.
          </p>

          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400 sm:text-base">
            Start free with 10 messages each month, or unlock full access for deeper, more consistent support.
          </p>
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-5xl gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/20">
            <div className="mb-6">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">
                Free
              </p>
              <h2 className="mt-2 text-3xl font-bold text-white">R0</h2>
              <p className="mt-2 text-slate-300">Try Alina before you commit.</p>
            </div>

            <ul className="space-y-3 text-sm text-slate-300">
              <li>• 10 free messages per month</li>
              <li>• Immediate access to the chat</li>
              <li>• Perfect for testing the experience</li>
            </ul>

            <button
              onClick={() => router.push("/login?next=/alina")}
              className="mt-8 w-full rounded-xl bg-white px-5 py-3 font-semibold text-slate-950 transition hover:opacity-90"
            >
              Start Free
            </button>
          </div>

          <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-b from-cyan-900/20 to-slate-900/90 p-8 shadow-2xl shadow-cyan-950/20">
            <div className="mb-6">
              <div className="mb-3 inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Pro
              </div>

              <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-200/80">
                Monthly Access
              </p>
              <h2 className="mt-2 text-3xl font-bold text-white">
                R50<span className="ml-1 text-base font-medium text-slate-300">/ month</span>
              </h2>
              <p className="mt-2 text-slate-200">
                Full access for users who want real support and deeper continuity.
              </p>
            </div>

            <ul className="space-y-3 text-sm text-slate-200">
              <li>• Unlimited daily access to Alina</li>
              <li>• Memory, vitals tracking, and deeper conversations</li>
            </ul>

            <button
              onClick={() => router.push("/login?next=/upgrade")}
              className="mt-8 flex w-full items-center justify-center rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              Unlock Full Access
            </button>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-slate-500">
          Live now on alinalabs.com. Start free, or upgrade after login with PayPal.
        </p>
      </section>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-white">
          <section className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
            <div className="text-sm text-slate-400">Loading Alina...</div>
          </section>
        </main>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
