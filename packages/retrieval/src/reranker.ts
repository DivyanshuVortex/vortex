import { pipeline, env } from "@xenova/transformers";
import { Chunk } from "./chunker";
import { ScoredChunk } from "./types";

// Configure transformers for server-side usage
env.allowLocalModels = true;
env.useBrowserCache = false;

/**
 * Cross-Encoder reranker that provides high-accuracy relevance scoring.
 *
 * Unlike bi-encoders (which embed query and document independently),
 * a cross-encoder processes the (query, document) pair together,
 * allowing deep token-level interaction for much more accurate scoring.
 *
 * Uses `Xenova/ms-marco-MiniLM-L-6-v2` — a compact (~22MB) cross-encoder
 * fine-tuned on MS MARCO passage ranking.
 */
export class CrossEncoderReranker {
  private modelPromise: Promise<any>;
  private static MODEL_NAME = "Xenova/ms-marco-MiniLM-L-6-v2";

  constructor() {
    this.modelPromise = pipeline(
      "text-classification",
      CrossEncoderReranker.MODEL_NAME,
      { quantized: true }
    );
  }

  /**
   * Reranks a list of chunks against a query using the cross-encoder model.
   *
   * Each chunk is scored as a (query, chunk.content) pair. Results are
   * sorted by descending relevance score.
   *
   * @param query - The user's search query
   * @param chunks - Array of chunks to rerank
   * @param topK - Number of top results to return after reranking
   * @returns Array of ScoredChunks sorted by cross-encoder relevance score
   */
  public async rerank(
    query: string,
    chunks: Chunk[],
    topK: number = 10
  ): Promise<ScoredChunk[]> {
    if (chunks.length === 0) return [];

    const model = await this.modelPromise;

    const pairs = chunks.map((chunk) => ({
      text: query,
      text_pair: this.truncateForModel(chunk.content),
    }));

    const scored: ScoredChunk[] = [];

    // Process in true batches using Promise.all for concurrent inference
    const BATCH_SIZE = 16;
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);

      // Run all items in the batch concurrently
      const batchResults = await Promise.all(
        batch.map(async (pair, j) => {
          try {
            const result = await model(pair.text, {
              text_pair: pair.text_pair,
            });

            const score = Array.isArray(result)
              ? (result[0] as any)?.score ?? 0
              : (result as any)?.score ?? 0;

            return {
              chunk: batchChunks[j]!,
              score,
              source: "reranker" as const,
            };
          } catch {
            return {
              chunk: batchChunks[j]!,
              score: -1,
              source: "reranker" as const,
            };
          }
        })
      );

      scored.push(...batchResults);
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
  }

  /**
   * Truncates content to fit within the cross-encoder's token limit.
   * MiniLM models typically have a 512 token limit (~2000 chars).
   */
  private truncateForModel(content: string, maxChars: number = 1500): string {
    if (content.length <= maxChars) return content;
    return content.slice(0, maxChars) + "...";
  }
}
