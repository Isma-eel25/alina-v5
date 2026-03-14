import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SignupBody = {
  email?: string;
  password?: string;
  inviteCode?: string;
};

function normalizeCode(code: string) {
  return code.trim();
}

export async function POST(req: Request) {
  let body: SignupBody | null = null;

  try {
    body = (await req.json()) as SignupBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const email = (body?.email ?? "").trim().toLowerCase();
  const password = body?.password ?? "";
  const inviteCode = normalizeCode(body?.inviteCode ?? "");

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required." },
      { status: 400 }
    );
  }

  // Optional: tiering for launch pricing
  // - If inviteCode matches ALINA_WAITLIST_CODE => waitlist tier
  // - If inviteCode matches ALINA_PUBLIC_CODE   => public tier
  // - Otherwise => free (not pro)
  const waitlistCode = (process.env.ALINA_WAITLIST_CODE ?? "").trim();
  const publicCode = (process.env.ALINA_PUBLIC_CODE ?? "").trim();

  let pricingTier: "waitlist" | "public" | "free" = "free";
  let expectedPriceZar: 150 | 250 | 0 = 0;

  if (inviteCode && waitlistCode && inviteCode === waitlistCode) {
    pricingTier = "waitlist";
    expectedPriceZar = 150;
  } else if (inviteCode && publicCode && inviteCode === publicCode) {
    pricingTier = "public";
    expectedPriceZar = 250;
  }

  // For now, "pro" means: allowed to access /api/brain when ALINA_BRAIN_GATE_MODE=pro
  const plan = pricingTier === "free" ? "free" : "pro";

  try {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          plan,
          pricingTier,
          expectedPriceZar,
        },
      },
    });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      plan,
      pricingTier,
      expectedPriceZar,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Signup failed." },
      { status: 500 }
    );
  }
}
