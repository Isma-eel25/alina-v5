// src/app/api/debug/memories/route.ts
// 🧪 Debug API – read long-term memories from the DB-backed store

import { NextRequest } from "next/server";
import { getRecentMemories } from "@/lib/longTermMemory";

// Use nodejs runtime so this shares the same server runtime
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    const limitParam = searchParams.get("limit");
    const userIdParam = searchParams.get("userId");

    const limit = limitParam ? parseInt(limitParam, 10) || 50 : 50;
    // ✅ Always a string, never undefined
    const userId: string = userIdParam ?? "";

    const memories = await getRecentMemories({
      limit,
      userId,
    });

    return new Response(
      JSON.stringify({
        count: memories.length,
        memories,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Debug memories route error:", error);
    return new Response("Debug memories route error", { status: 500 });
  }
}