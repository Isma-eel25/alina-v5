import { NextResponse } from "next/server";
import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // Safe fallback for now – no crash in build, just a JSON error at runtime
      return NextResponse.json(
        { error: "Brain API not configured (missing OPENAI_API_KEY)." },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const body = await req.json();

    // You can adapt this later – for now, just echo something basic
    const userMessage = body?.message ?? "Hello from Alina brain.";

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    // Return the raw or simplified response
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("POST /api/brain error:", error);
    return NextResponse.json(
      { error: "Brain API error" },
      { status: 500 }
    );
  }
}
