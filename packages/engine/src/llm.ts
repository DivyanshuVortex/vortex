import { GoogleGenAI } from "@google/genai";
import { Groq } from "groq-sdk";
import { LLMCacheManager } from "./cache";

export interface GenerateOptions {
  retries?: number;
  /** Label for log messages (e.g., agent name) */
  label?: string;
  cache?: {
    enabled: boolean;
    commitHash?: string;
    retrievalContextHash?: string;
  };
}

const DEFAULT_MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "qwen/qwen3.6-27b",
  "qwen/qwen3-32b",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "llama-3.1-8b-instant",
  "allam-2-7b"
];

/**
 * Shared API call utility with exponential backoff retry and dynamic model fallbacks.
 *
 * This is the single source of truth for LLM API interactions across Vortex.
 * Used by both IntelligenceAgent (direct prompting) and BaseAgent (agent pipeline).
 *
 * Features:
 * - 120s timeout per request
 * - Exponential backoff on 503/429 (overloaded/rate-limited)
 * - Iterates through a configurable priority list of models
 */
export async function generateWithRetry(
  client: GoogleGenAI,
  prompt: string,
  options?: GenerateOptions
): Promise<string> {
  const maxRetriesPerModel = options?.retries ?? 3;
  const label = options?.label ?? "API";
  const useCache = options?.cache?.enabled && process.env.VORTEX_DISABLE_CACHE !== "true";

  const priorityString = process.env.VORTEX_MODEL_PRIORITY;
  const models = priorityString 
    ? priorityString.split(",").map(s => s.trim()).filter(Boolean)
    : [...DEFAULT_MODEL_PRIORITY];

  // Try to use the last successfully working model within the past hour
  const workingModel = await LLMCacheManager.getWorkingModel();
  if (workingModel && models.includes(workingModel)) {
    models.splice(models.indexOf(workingModel), 1);
    models.unshift(workingModel);
  }

  let lastError: any;

  for (const model of models) {
    const isGemini = model.toLowerCase().startsWith("gemini");
    const provider = isGemini ? "gemini" : "groq";
    
    // Check cache for this specific model
    let cacheInfo: ReturnType<typeof LLMCacheManager.generateCacheKey> | null = null;
    if (useCache) {
      cacheInfo = LLMCacheManager.generateCacheKey({
        provider,
        model,
        userPrompt: prompt,
        commitHash: options?.cache?.commitHash,
        retrievalContextHash: options?.cache?.retrievalContextHash,
      });
      const cachedResponse = await LLMCacheManager.getCache(cacheInfo.key);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    // Try API calls with retries
    let modelSuccess = false;
    let responseText = "";

    for (let i = 0; i < maxRetriesPerModel; i++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("API Request Timeout")), 120000)
        );

        if (isGemini) {
          const response: any = await Promise.race([
            client.models.generateContent({
              model: model,
              contents: prompt,
            }),
            timeoutPromise,
          ]);
          responseText = response.text || "";
        } else {
          const groqKey = process.env.GROQ_API_KEY;
          if (!groqKey) {
            throw new Error(`GROQ_API_KEY not set for model ${model}`);
          }
          const groqClient = new Groq({ apiKey: groqKey });
          const response: any = await Promise.race([
            groqClient.chat.completions.create({
              model: model,
              max_tokens: 4096,
              messages: [{ role: "user", content: prompt }],
            }),
            timeoutPromise,
          ]);
          responseText = response.choices[0]?.message?.content || "";
        }

        modelSuccess = true;
        break; // Break the retry loop on success
      } catch (err: any) {
        lastError = err;
        if (err.status === 503 || err.status === 429) {
          const delay = Math.pow(2, i) * 2000;
          console.warn(`\n[${label}] API Busy (${model}). Retrying in ${delay / 1000}s...`);
          await new Promise((res) => setTimeout(res, delay));
        } else {
          // Unrecoverable error for this model (e.g. invalid model, no API key)
          console.warn(`\n[${label}] Model ${model} failed/unavailable. Shifting to next...`);
          break; // Break the retry loop, move to next model
        }
      }
    }

    // If the model succeeded, cache and return
    if (modelSuccess) {
      await LLMCacheManager.setWorkingModel(model);
      if (useCache && cacheInfo) {
        await LLMCacheManager.setCache({
          key: cacheInfo.key,
          model: model,
          response: responseText,
          promptHash: cacheInfo.promptHash,
          contextHash: cacheInfo.contextHash,
          commitHash: options?.cache?.commitHash,
        });
      }
      return responseText;
    }
    
    // If it didn't succeed after retries, it will continue to the next model in the outer loop
    if (!modelSuccess && lastError?.status && (lastError.status === 503 || lastError.status === 429)) {
      console.warn(`\n[${label}] Exhausted retries for ${model}. Shifting to next...`);
    }
  }

  throw new Error(
    `[${label}] All models in the priority list failed. Please check your API keys or rate limits.`
  );
}
