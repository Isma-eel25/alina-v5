// src/app/api/billing/checkout/route.ts
//
// Step: Redirect the logged-in user to the correct PayPal payment link.
// - Keeps billing isolated from AI core.
// - Uses Supabase session cookies (server client) to identify the user.
// - Chooses waitlist/public pricing based on user metadata.
// - Works with PayPal payment links / buttons (no provider backend required here).
//
// Env required:
// - PAYPAL_PAYMENT_LINK_WAITLIST
// - PAYPAL_PAYMENT_LINK_PUBLIC
//
// Optional:
// - ALINA_PUBLIC_ORIGIN=\"https://alinalabs.com\"
//
// Important:
// - This route only sends the user to PayPal checkout.
// - Access unlocking should be handled by your post-payment flow.

import { NextRequest } from "next/server";
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

function safeReturnTo(v: string | null): string {
  // Prevent open redirects. Only allow internal paths.
  if (!v) return "/alina";
  try {
    if (v.startsWith("/") && !v.startsWith("//")) return v;
  } catch {}
  return "/alina";
}

function withQuery(url: string, params: Record<string, string>): string {
  try {
    const u = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value) u.searchParams.set(key, value);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const waitlistLink = process.env.PAYPAL_PAYMENT_LINK_WAITLIST;
  const publicLink = process.env.PAYPAL_PAYMENT_LINK_PUBLIC;

  if (!waitlistLink || !publicLink) {
    return new Response(
      JSON.stringify({
        error: "billing_not_configured",
        missing: [
          !waitlistLink ? "PAYPAL_PAYMENT_LINK_WAITLIST" : null,
          !publicLink ? "PAYPAL_PAYMENT_LINK_PUBLIC" : null,
        ].filter(Boolean),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  const form = await req.formData().catch(() => null);
  const returnTo = safeReturnTo((form?.get("returnTo") as string | null) ?? null);

  const tier = getTier(user);
  const expected = getExpectedPrice(user);
  const isWaitlist = tier === "waitlist";
  const priceZar = expected ?? (isWaitlist ? 150 : 250);

  const reqOrigin = req.nextUrl.origin;
  const origin = process.env.ALINA_PUBLIC_ORIGIN || reqOrigin;
  const successUrl = `${origin}${returnTo}?checkout=success`;

  const baseLink = isWaitlist ? waitlistLink : publicLink;

  // If your PayPal link ignores extra params, that is fine.
  // These are still useful for visibility and future reconciliation.
  const checkoutUrl = withQuery(baseLink, {
    email: user.email ?? "",
    user_id: user.id,
    tier: isWaitlist ? "waitlist" : "public",
    expected_price_zar: String(priceZar),
    return_to: successUrl,
  });

  return new Response(null, {
    status: 303,
    headers: {
      Location: checkoutUrl,
    },
  });
}
