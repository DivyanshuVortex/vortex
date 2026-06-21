import { pipeline, env } from "@xenova/transformers";
import { Chunk } from "./chunker";

// Configure transformers for server-side usage
env.allowLocalModels = true;
env.useBrowserCache = false;

/**
 * A scored chunk combines a retrieval result with its relevance score.
 * Used as the common interface across all retrieval strategies.
 */
export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  /** Which retrieval method contributed this result */
  source: "vector" | "bm25" | "reranker";
}

/**
 * Cross-Encoder reranker that provides high-accuracy relevance scoring.
 *
 * Unlike bi-encoders (which embed query and document independently),
 * a cross-encoder processes the (query, document) pair together,
 * allowing deep token-level interaction for much more accurate scoring.
 *
 * Uses `Xenova/ms-marco-MiniLM-L-6-v2` — a compact (~22MB) cross-encoder
 * fine-tuned on MS MARCO passage ranking.
 *
 * Architecture:
 * ┌─────────────────────────────┐
 * │  Cross-Encoder Model        │
 * │  Input: [query, document]   │
 * │  Output: relevance score    │
 * └─────────────────────────────┘
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
   * For each chunk, the model scores the (query, chunk.content) pair to determine
   * how relevant the chunk is to the query. Results are sorted by descending score.
   *
   * @param query - The user's search query
   * @param chunks - Array of chunks to rerank (typically merged results from vector + BM25)
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


    const BATCH_SIZE = 16;
    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);


      for (let j = 0; j < batch.length; j++) {
        try {
          const pair = batch[j]!;
          const result = await model(pair.text, {
            text_pair: pair.text_pair,
          });


          const score = Array.isArray(result)
            ? (result[0] as any)?.score ?? 0
            : (result as any)?.score ?? 0;

          scored.push({
            chunk: batchChunks[j]!,
            score,
            source: "reranker",
          });
        } catch (err) {
          scored.push({
            chunk: batchChunks[j]!,
            score: -1,
            source: "reranker",
          });
        }
      }
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
