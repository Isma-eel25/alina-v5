// src/app/api/billing/checkout/route.ts
//
// Step: Create a Lemon Squeezy checkout URL for the logged-in user and redirect.
// - Keeps billing isolated from AI core.
// - Uses Supabase session cookies (server client) to identify the user.
// - Uses Lemon Squeezy Checkouts API to generate a one-time URL.
// - Passes supabase_user_id + tier in checkout custom data so the webhook can unlock Pro.
//
// Env required:
// - LEMON_SQUEEZY_API_KEY
// - LEMON_SQUEEZY_STORE_ID
// - LEMON_SQUEEZY_VARIANT_ID_WAITLIST
// - LEMON_SQUEEZY_VARIANT_ID_PUBLIC
// Optional:
// - LEMON_SQUEEZY_TEST_MODE="true" for test mode
// - ALINA_PUBLIC_ORIGIN="https://your-domain.com" (fallbacks to request origin)

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
  // Prevent open-redirects. Only allow internal paths.
  if (!v) return "/alina";
  try {
    if (v.startsWith("/") && !v.startsWith("//")) return v;
  } catch {}
  return "/alina";
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

  const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
  const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
  const variantWaitlist = process.env.LEMON_SQUEEZY_VARIANT_ID_WAITLIST;
  const variantPublic = process.env.LEMON_SQUEEZY_VARIANT_ID_PUBLIC;

  if (!apiKey || !storeId || !variantWaitlist || !variantPublic) {
    return new Response(
      JSON.stringify({
        error: "billing_not_configured",
        missing: [
          !apiKey ? "LEMON_SQUEEZY_API_KEY" : null,
          !storeId ? "LEMON_SQUEEZY_STORE_ID" : null,
          !variantWaitlist ? "LEMON_SQUEEZY_VARIANT_ID_WAITLIST" : null,
          !variantPublic ? "LEMON_SQUEEZY_VARIANT_ID_PUBLIC" : null,
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

  const variantId = isWaitlist ? variantWaitlist : variantPublic;

  // Determine origin for redirect_url (Lemon Squeezy needs absolute URL).
  const reqOrigin = req.nextUrl.origin;
  const origin = process.env.ALINA_PUBLIC_ORIGIN || reqOrigin;

  // IMPORTANT: This redirect does NOT unlock Pro by itself.
  // Pro unlock must happen via the webhook (next step), using the custom data below.
  const redirectUrl = `${origin}${returnTo}?checkout=success`;

  const testMode =
    String(process.env.LEMON_SQUEEZY_TEST_MODE ?? "")
      .toLowerCase()
      .trim() === "true";

  // Lemon Squeezy custom_price is in cents.
  const customPriceCents = Math.round(priceZar * 100);

  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        custom_price: customPriceCents,
        product_options: {
          enabled_variants: [Number(variantId)],
          redirect_url: redirectUrl,
        },
        checkout_data: {
          email: user.email ?? "",
          custom: {
            supabase_user_id: user.id,
            pricing_tier: isWaitlist ? "waitlist" : "public",
            expected_price_zar: priceZar,
            return_to: returnTo,
          },
        },
        test_mode: testMode,
      },
      relationships: {
        store: { data: { type: "stores", id: String(storeId) } },
        variant: { data: { type: "variants", id: String(variantId) } },
      },
    },
  };

  const lsRes = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!lsRes.ok) {
    const text = await lsRes.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: "lemonsqueezy_checkout_failed",
        status: lsRes.status,
        details: text.slice(0, 2000),
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  const json = (await lsRes.json()) as any;
  const url = json?.data?.attributes?.url as string | undefined;

  if (!url) {
    return new Response(
      JSON.stringify({ error: "lemonsqueezy_no_url_returned" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: url,
    },
  });
}
