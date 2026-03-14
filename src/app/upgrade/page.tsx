import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Tier = "waitlist" | "public" | "free" | undefined;

function getTier(user: any): Tier {
  return (
    user?.user_metadata?.pricingTier ??
    user?.app_metadata?.pricingTier ??
    user?.user_metadata?.tier ??
    user?.app_metadata?.tier
  );
}

function getExpectedPrice(user: any): number | null {
  const v =
    user?.user_metadata?.expectedPriceZar ??
    user?.app_metadata?.expectedPriceZar ??
    null;
  return typeof v === "number" ? v : null;
}

export default async function UpgradePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const tier = getTier(user);
  const expected = getExpectedPrice(user);

  const isWaitlist = tier === "waitlist";
  const price = expected ?? (isWaitlist ? 150 : 250);

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="text-sm text-white/70">Alina • Upgrade</div>
        <h1 className="mt-2 text-2xl font-semibold">Unlock full access</h1>

        <p className="mt-3 text-sm text-white/70">
          Your account is currently on the{" "}
          <span className="text-white">{isWaitlist ? "Waitlist" : "Public"}</span>{" "}
          tier.
        </p>

        <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <div className="text-xs text-white/60">Price</div>
          <div className="mt-1 text-3xl font-bold">
            R{price}
            <span className="text-base font-medium text-white/60">/month</span>
          </div>
          <div className="mt-2 text-xs text-white/60">
            Tier is based on your invite code at signup.
          </div>
        </div>

        {/* Step 1 wiring: this posts to our billing route, which will decide the right tier + create the provider checkout. */}
        <form action="/api/billing/checkout" method="POST" className="mt-6">
          <input type="hidden" name="returnTo" value="/alina" />
          <button
            type="submit"
            className="block w-full rounded-xl bg-white text-black text-center py-3 text-sm font-semibold hover:opacity-90"
          >
            Continue to payment
          </button>
        </form>

        <div className="mt-6 text-xs text-white/50">
          After payment, we’ll mark your account as{" "}
          <span className="text-white/80">Pro</span> and the chat will unlock.
        </div>

        <a
          href="/alina"
          className="mt-4 inline-block text-xs text-white/70 hover:text-white"
        >
          ← Back to chat
        </a>
      </div>
    </main>
  );
}
