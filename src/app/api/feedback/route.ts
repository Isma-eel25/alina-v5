// src/app/api/feedback/route.ts

import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addFeedbackEntry, type FeedbackRating } from "@/lib/longTermMemory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FeedbackRequestBody = {
  messageId?: string;
  rating?: FeedbackRating;
  comment?: string | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user?.id) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = (await req.json().catch(() => null)) as FeedbackRequestBody | null;
    const messageId = typeof body?.messageId === "string" ? body.messageId.trim() : "";
    const rating = body?.rating;
    const comment = typeof body?.comment === "string" ? body.comment.trim() : null;

    if (!messageId) {
      return jsonResponse({ error: "Missing messageId." }, 400);
    }

    if (rating !== "helpful" && rating !== "not_helpful") {
      return jsonResponse({ error: "Invalid rating." }, 400);
    }

    const entry = await addFeedbackEntry({
      userId: user.id,
      messageId,
      rating,
      comment,
    });

    return jsonResponse({ ok: true, feedback: entry }, 200);
  } catch (error) {
    console.error("[alina_feedback] failed", error);
    return jsonResponse({ error: "Could not save feedback." }, 500);
  }
}
