import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, name, note, source } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const entry = await prisma.waitlistEntry.create({
      data: { email, name, note, source },
    });

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    console.error("POST /api/waitlist error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const entries = await prisma.waitlistEntry.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(entries);
  } catch (err) {
    console.error("GET /api/waitlist error", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
