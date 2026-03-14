// src/lib/openai.ts
import OpenAI from "openai";

const key = process.env.OPENAI_API_KEY;

if (!key) {
  throw new Error("Missing OPENAI_API_KEY in environment.");
}

// 🔍 TEMP: Log partial key info to confirm what Node is actually using
console.log("OPENAI_API_KEY prefix:", key.slice(0, 12));
console.log("OPENAI_API_KEY suffix:", key.slice(-4));
console.log("OPENAI_API_KEY length:", key.length);

/**
 * Shared OpenAI client for the entire Alina V5 system.
 * No hard-coded keys. Reads from .env.
 */
export const openai = new OpenAI({
  apiKey: key,
});
