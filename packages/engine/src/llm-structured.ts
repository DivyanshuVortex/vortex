import { z } from "zod";
import { generateWithRetry, GenerateOptions } from "./llm";
import { GoogleGenAI } from "@google/genai";

export async function generateStructured<T>(
  client: GoogleGenAI,
  prompt: string,
  schema: z.ZodType<T>,
  options?: GenerateOptions & { maxValidationRetries?: number }
): Promise<T> {
  const maxRetries = options?.maxValidationRetries ?? 3;
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const responseText = await generateWithRetry(client, currentPrompt, options);

    try {
      // 1. Strip markdown fences if present
      let cleanText = responseText.trim();
      if (cleanText.startsWith("```json")) {
        cleanText = cleanText.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```/, "").replace(/```$/, "").trim();
      }

      // 2. Parse JSON
      const parsedJson = JSON.parse(cleanText);

      // 3. Validate with Zod
      const result = schema.safeParse(parsedJson);
      
      if (result.success) {
        return result.data;
      }

      // 4. On failure, inject error back
      const errorMsg = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("\n");
      if (process.env.DEBUG) {
        console.warn(`[Structured LLM] Validation failed (Attempt ${attempt}/${maxRetries}):\n${errorMsg}`);
      }
      
      if (attempt === maxRetries) {
        throw new Error(`Failed to generate valid structured output after ${maxRetries} attempts. Last error: ${errorMsg}`);
      }

      currentPrompt += `\n\nYour previous JSON response was invalid. Please fix the following errors and try again:\n${errorMsg}\nMake sure to output ONLY valid JSON matching the exact schema requested.`;
      
    } catch (e: any) {
      if (process.env.DEBUG) {
        console.warn(`[Structured LLM] JSON Parsing failed (Attempt ${attempt}/${maxRetries}):\n${e.message}`);
      }

      if (attempt === maxRetries) {
         throw new Error(`Failed to parse JSON after ${maxRetries} attempts. Last response: ${responseText.slice(0, 200)}...`);
      }

      currentPrompt += `\n\nYour previous response was not valid JSON. Error: ${e.message}\nPlease output ONLY valid JSON.`;
    }
  }

  throw new Error("Unreachable");
}
