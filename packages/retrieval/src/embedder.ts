import { GoogleGenAI } from "@google/genai";
import { Chunk } from "./chunker";

export class GeminiEmbedder {
  private client: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
  }

  public formatChunk(chunk: Chunk): string {
    let textToEmbed = `File: ${chunk.file}\n`;
    textToEmbed += `Symbol: ${chunk.symbolPath} (${chunk.kind})\n`;

    if (chunk.dependencies.length > 0) {
      textToEmbed += `Dependencies: ${chunk.dependencies.join(", ")}\n`;
    }

    if (chunk.signature) {
      textToEmbed += `Signature: ${chunk.signature}\n`;
    }

    textToEmbed += `\nCode:\n${chunk.content}`;

    return textToEmbed;
  }

  public async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    if (chunks.length === 0) return [];

    const formattedTexts = chunks.map(c => this.formatChunk(c));
    const embeddings: number[][] = [];

    // The Gemini embed endpoint supports up to 100 texts per request or fewer depending on limits.
    // For safety, we will request them in batches or sequentially. We will do sequentially for simplicity,
    // but in a production tool you might use Promise.all with concurrency limits.
    for (const text of formattedTexts) {
      const response = await this.client.models.embedContent({
        model: "gemini-embedding-001",
        contents: text,
      });

      const embedding = response.embeddings?.[0]?.values;
      if (embedding) {
        embeddings.push(embedding);
      } else {
        throw new Error("Failed to get embedding from Gemini");
      }
    }

    return embeddings;
  }
}
