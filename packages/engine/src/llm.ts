import { GoogleGenAI } from "@google/genai";
import { Groq } from "groq-sdk";
import OpenAI from "openai";
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

export const DEFAULT_MODEL_PRIORITY = [
  // Gemini
  "gemini-2.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",

  // Groq
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "allam-2-7b",

  // OpenRouter
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nex-agi/nex-n2-pro:free",
  "openrouter/owl-alpha",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-20b:free",
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
  "qwen/qwen3-32b",
];

const getApiKeys = (prefix: string): string[] => {
  const keys: string[] = [];
  if (process.env[prefix]) {
    keys.push(...process.env[prefix]!.split(',').map(k => k.trim()).filter(Boolean));
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(`${prefix}_`) && typeof value === 'string' && value) {
      keys.push(...value.split(',').map(k => k.trim()).filter(Boolean));
    }
  }
  return [...new Set(keys)];
};

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


  const workingModel = await LLMCacheManager.getWorkingModel();
  if (workingModel && models.includes(workingModel)) {
    models.splice(models.indexOf(workingModel), 1);
    models.unshift(workingModel);
  }

  let lastError: any;

  for (const model of models) {
    const isGemini = model.toLowerCase().startsWith("gemini");
    const isOpenRouter = model.includes("/");
    const provider = isGemini ? "gemini" : (isOpenRouter ? "openrouter" : "groq");


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


    let modelSuccess = false;
    let responseText = "";

    for (let i = 0; i < maxRetriesPerModel; i++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("API Request Timeout")), 120000)
        );

        if (isGemini) {
          const geminiKeys = getApiKeys('GEMINI_API_KEY');
          const keyToUse = geminiKeys.length > 0 ? geminiKeys[i % geminiKeys.length] : undefined;
          const currentClient = (i > 0 && keyToUse) ? new GoogleGenAI({ apiKey: keyToUse }) : client;

          const response: any = await Promise.race([
            currentClient.models.generateContent({
              model: model,
              contents: prompt,
            }),
            timeoutPromise,
          ]);
          responseText = response.text || "";
        } else if (isOpenRouter) {
          const openRouterKeys = getApiKeys('OPENROUTER_API_KEY');
          const keyToUse = openRouterKeys.length > 0 ? openRouterKeys[i % openRouterKeys.length] : process.env.OPENROUTER_API_KEY;

          if (!keyToUse) {
            throw new Error(`OPENROUTER_API_KEY not set for model ${model}`);
          }
          const openRouterClient = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: keyToUse });
          const response: any = await Promise.race([
            openRouterClient.chat.completions.create({
              model: model,
              max_tokens: 4096,
              messages: [{ role: "user", content: prompt }],
            }),
            timeoutPromise,
          ]);
          responseText = response.choices[0]?.message?.content || "";
        } else {
          const groqKeys = getApiKeys('GROQ_API_KEY');
          const keyToUse = groqKeys.length > 0 ? groqKeys[i % groqKeys.length] : process.env.GROQ_API_KEY;

          if (!keyToUse) {
            throw new Error(`GROQ_API_KEY not set for model ${model}`);
          }
          const groqClient = new Groq({ apiKey: keyToUse });
          const response: any = await Promise.race([
            groqClient.chat.completions.create({
              model: model,
              max_tokens: 6000,
              messages: [{ role: "user", content: prompt }],
            }),
            timeoutPromise,
          ]);
          responseText = response.choices[0]?.message?.content || "";
        }

        if (!responseText.trim()) {
          throw new Error(`Model ${model} returned an empty string. Context filter or failure suspected.`);
        }

        modelSuccess = true;
        break;
      } catch (err: any) {
        lastError = err;
        if (err.status === 503 || err.status === 429) {
          const delay = Math.pow(2, i) * 2000;
          if (process.env.DEBUG) console.warn(`\n[${label}] API Busy (${model}). Retrying in ${delay / 1000}s...`);
          await new Promise((res) => setTimeout(res, delay));
        } else {
          if (process.env.DEBUG) console.warn(`\n[${label}] Model ${model} failed/unavailable. Shifting to next...`);
          break;
        }
      }
    }


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

    if (!modelSuccess && lastError?.status && (lastError.status === 503 || lastError.status === 429)) {
      if (process.env.DEBUG) console.warn(`\n[${label}] Exhausted retries for ${model}. Shifting to next...`);
    }
  }

  throw new Error(
    `[${label}] All models in the priority list failed. Please check your API keys or rate limits.`
  );
}
