import { GoogleGenAI } from "@google/genai";

/**
 * Shared Gemini API call utility with exponential backoff retry.
 *
 * This is the single source of truth for LLM API interactions across Vortex.
 * Used by both IntelligenceAgent (direct prompting) and BaseAgent (agent pipeline).
 *
 * Features:
 * - 120s timeout per request
 * - Exponential backoff on 503/429 (overloaded/rate-limited)
 * - Up to 5 retries by default
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
  const retries = options?.retries ?? 5;
  const label = options?.label ?? "API";

  for (let i = 0; i < retries; i++) {
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
      if (err.status === 503 || err.status === 429) {
        const delay = Math.pow(2, i) * 2000;
        console.warn(
          `\n[${label}] API Busy (${err.status}). Retrying in ${delay / 1000}s...`
        );
        await new Promise((res) => setTimeout(res, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error(
    `[${label}] Failed to generate content after maximum retries.`
  );
}
