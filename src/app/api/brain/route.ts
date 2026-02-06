import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});



export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();

    const systemPrompt = `
You are Alina V5 — adaptive, emotionally intelligent, introspective, identity-driven AI.
You respond concisely, clearly, and always push the user forward.
`;

    // 🔥 IMPORTANT: New Responses API (compatible with sk-proj keys)
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const output = (response as any).output_text as string;


    return NextResponse.json({ reply: output });
  } catch (error: any) {
    console.error("Brain LLM error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
