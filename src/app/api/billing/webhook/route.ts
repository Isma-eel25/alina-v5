// src/app/api/billing/webhook/route.ts
//
// Lemon Squeezy webhook handler to unlock Pro automatically after verified payment.
//
// What this does:
// - Verifies the X-Signature (HMAC SHA-256 of raw body) using LEMON_SQUEEZY_WEBHOOK_SECRET.
// - Handles subscription events that indicate an active/paid subscription.
// - Uses meta.custom_data.supabase_user_id (sent from checkout creation) to find the user.
// - Updates Supabase user_metadata to set: plan="pro", is_subscribed=true
//
// Env required:
// - LEMON_SQUEEZY_WEBHOOK_SECRET
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
//
// Notes:
// - This endpoint MUST NOT be behind auth/proxy gating.
// - Do not treat return-url redirects as proof of payment; only this webhook unlocks Pro.

import crypto from "crypto";
import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type LemonSqueezyWebhook = {
  meta?: {
    event_name?: string;
    custom_data?: Record<string, any>;
  };
  data?: {
    id?: string;
    type?: string;
    attributes?: Record<string, any>;
  };
};

function timingSafeEqualHex(a: string, b: string) {
  // Prevent timing attacks and handle different lengths safely.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeSignature(rawBody: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function shouldUnlock(eventName: string) {
  // Minimal safe set for monthly subscriptions:
  // - subscription_created: first creation (usually includes initial payment)
  // - subscription_payment_success: recurring payment success
  // - subscription_updated: in case you upgrade/downgrade (we’ll still check status)
  return (
    eventName === "subscription_created" ||
    eventName === "subscription_payment_success" ||
    eventName === "subscription_updated"
  );
}

function isActiveSubscription(payload: LemonSqueezyWebhook) {
  // Lemon Squeezy subscription attributes commonly include status.
  // We accept "active" and also "trialing" if you ever enable trials.
  const status = String(payload?.data?.attributes?.status ?? "").toLowerCase();
  return status === "active" || status === "trialing";
}

export async function POST(req: NextRequest) {
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

  if (!secret) {
    return new Response(JSON.stringify({ error: "webhook_not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const signature = req.headers.get("x-signature") ?? "";
  const eventNameHeader = req.headers.get("x-event-name") ?? "";

  // IMPORTANT: Verify signature using the RAW body, not parsed JSON.
  const rawBody = await req.text();

  const expected = computeSignature(rawBody, secret);
  if (!signature || !timingSafeEqualHex(signature, expected)) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let payload: LemonSqueezyWebhook | null = null;
  try {
    payload = JSON.parse(rawBody) as LemonSqueezyWebhook;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const eventName =
    (payload?.meta?.event_name as string | undefined) ||
    eventNameHeader ||
    "";

  // Always ACK unknown events after verification (prevents re-delivery storms).
  if (!shouldUnlock(eventName)) {
    return new Response(JSON.stringify({ ok: true, ignored: eventName }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // Pull user id from meta.custom_data (Lemon Squeezy docs: custom_data is inside meta)
  const custom = payload?.meta?.custom_data ?? {};
  const supabaseUserId =
    (custom?.supabase_user_id as string | undefined) ||
    (custom?.user_id as string | undefined) ||
    "";

  if (!supabaseUserId) {
    return new Response(JSON.stringify({ error: "missing_supabase_user_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // If this is a subscription_updated event, confirm it's active before unlocking.
  if (eventName === "subscription_updated" && !isActiveSubscription(payload)) {
    return new Response(JSON.stringify({ ok: true, status: "not_active" }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const admin = createSupabaseAdminClient();

  const lemonsqueezySubscriptionId = String(payload?.data?.id ?? "");
  const lemonsqueezyStatus = String(payload?.data?.attributes?.status ?? "");

  // Write minimal subscription flags the brain gate already checks.
  const { error } = await admin.auth.admin.updateUserById(supabaseUserId, {
    user_metadata: {
      plan: "pro",
      is_subscribed: true,
      // keep existing pricingTier/expectedPriceZar if already present
      lemonsqueezy: {
        subscription_id: lemonsqueezySubscriptionId || undefined,
        status: lemonsqueezyStatus || undefined,
        last_event: eventName || undefined,
        updated_at: new Date().toISOString(),
      },
    },
  });

  if (error) {
    return new Response(
      JSON.stringify({ error: "supabase_update_failed", details: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  return new Response(JSON.stringify({ ok: true, unlocked: true, eventName }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
