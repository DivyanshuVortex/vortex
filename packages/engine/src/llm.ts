import { GoogleGenAI } from "@google/genai";
import { Groq } from "groq-sdk";

/**
 * Shared Gemini API call utility with exponential backoff retry.
 * Includes Groq API as a fallback if Gemini fails.
 *
 * This is the single source of truth for LLM API interactions across Vortex.
 * Used by both IntelligenceAgent (direct prompting) and BaseAgent (agent pipeline).
 *
 * Features:
 * - 120s timeout per request
 * - Exponential backoff on 503/429 (overloaded/rate-limited)
 * - Up to 3 retries for Gemini, followed by 3 retries for Groq
 */
export async function generateWithRetry(
  client: GoogleGenAI,
  prompt: string,
  options?: {
    retries?: number;
    /** Label for log messages (e.g., agent name) */
    label?: string;
  }
): Promise<string> {
  const maxGeminiRetries = options?.retries ?? 3;
  const maxGroqRetries = 3;
  const label = options?.label ?? "API";
  let lastError: any;

  // 1. Try Gemini API
  for (let i = 0; i < maxGeminiRetries; i++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("API Request Timeout")),
          120000
        )
      );
      const response: any = await Promise.race([
        client.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        }),
        timeoutPromise,
      ]);
      return response.text || "";
    } catch (err: any) {
      lastError = err;
      if (err.status === 503 || err.status === 429) {
        const delay = Math.pow(2, i) * 2000;
        console.warn(
          `\n[${label}] Gemini API Busy (${err.status}): ${err.message}\nRetrying in ${delay / 1000}s...`
        );
        await new Promise((res) => setTimeout(res, delay));
      } else {
        // For other errors, break and try fallback
        break;
      }
    }
  }

  console.warn(`\n[${label}] Gemini API failed. Shifting to Groq API fallback...`);

  // 2. Try Groq API Fallback
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error(
      `[${label}] Both Gemini and Groq APIs failed. Please try again after 1 or 2 hours. (Groq API key not set)`
    );
  }

  const groqClient = new Groq({ apiKey: groqKey });

  for (let i = 0; i < maxGroqRetries; i++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("API Request Timeout")),
          120000
        )
      );
      const response: any = await Promise.race([
        groqClient.chat.completions.create({
          model: "allam-2-7b", // User requested fallback model
          messages: [{ role: "user", content: prompt }],
        }),
        timeoutPromise,
      ]);
      return response.choices[0]?.message?.content || "";
    } catch (err: any) {
      lastError = err;
      // Groq also returns 429 for rate limit and 503 for unavailable
      if (err.status === 503 || err.status === 429) {
        const delay = Math.pow(2, i) * 2000;
        console.warn(
          `\n[${label}] Groq API Busy (${err.status}): ${err.message}\nRetrying in ${delay / 1000}s...`
        );
        await new Promise((res) => setTimeout(res, delay));
      } else {
        break;
      }
    }
  }

  throw new Error(
    `[${label}] Both Gemini and Groq APIs failed after 3 retries. Please try again after 1 or 2 hours.`
  );
}
