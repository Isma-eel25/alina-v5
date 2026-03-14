"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const WAITLIST_PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GFMJ82BZCU5Z2";

export default function HomePage() {
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

          <div className="rounded-2xl border border-purple-500/40 bg-gradient-to-b from-purple-900/30 to-slate-900/90 p-8 shadow-2xl shadow-purple-950/20">
            <div className="mb-6">
              <div className="mb-3 inline-flex rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">
                Waitlist Offer
              </div>

              <p className="text-sm font-medium uppercase tracking-[0.2em] text-purple-200/80">
                Monthly Access
              </p>
              <h2 className="mt-2 text-3xl font-bold text-white">$8<span className="ml-1 text-base font-medium text-slate-300">/ month</span></h2>
              <p className="mt-2 text-slate-200">
                Early supporter pricing for waitlist users.
              </p>
            </div>

            <ul className="space-y-3 text-sm text-slate-200">
              <li>• Ongoing access to Alina</li>
              <li>• Built for consistency and deeper conversations</li>
              <li>• Early pricing before public rate increases</li>
            </ul>

            <a
              href={WAITLIST_PAYPAL_LINK}
              target="_blank"
              rel="noreferrer"
              className="mt-8 flex w-full items-center justify-center rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white transition hover:bg-purple-700"
            >
              Get Monthly Access
            </a>
          </div>
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-slate-500">
          Public pricing can be added next. For now, the site opens on the real product entry page instead of the waitlist.
        </p>
      </section>
    </main>
  );
}
