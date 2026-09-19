import { Chunk } from "./chunker";
import { pipeline, env, FeatureExtractionPipeline, AutoTokenizer, PreTrainedTokenizer } from '@xenova/transformers';

// Configure transformers to only cache models locally and suppress unnecessary warnings
env.allowLocalModels = true;
env.useBrowserCache = false;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
// MiniLM-L6-v2 has a 256 token limit for input sequences
const MODEL_MAX_TOKENS = 256;
// Reserve tokens for special tokens ([CLS], [SEP])
const EFFECTIVE_MAX_TOKENS = 250;

export class LocalEmbedder {
  private extractorPromise: Promise<FeatureExtractionPipeline>;
  private tokenizerPromise: Promise<PreTrainedTokenizer>;

  constructor() {
    this.extractorPromise = pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    }) as Promise<FeatureExtractionPipeline>;

    this.tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_NAME);
  }

  /**
   * Format a chunk for embedding.
   *
   * Builds a structured metadata prefix followed by as much code
   * as fits within the model's actual token limit (not a char estimate).
   */
  public async formatChunk(chunk: Chunk): Promise<string> {
    const tokenizer = await this.tokenizerPromise;

    // Build structured metadata prefix
    const metaParts: string[] = [];
    metaParts.push(`[${chunk.language}] ${chunk.kind}: ${chunk.symbolPath}`);

    if (chunk.signature) {
      metaParts.push(`sig: ${chunk.signature}`);
    }

    if (chunk.dependencies.length > 0) {
      // Limit to top 8 dependencies to save tokens
      const topDeps = chunk.dependencies.slice(0, 8).join(", ");
      metaParts.push(`deps: ${topDeps}`);
    }

    if (chunk.parent) {
      metaParts.push(`parent: ${chunk.parent}`);
    }

    const metaText = metaParts.join(" | ");

    // Count tokens used by metadata
    const metaTokens = this.countTokens(tokenizer, metaText + "\n");
    const remainingBudget = EFFECTIVE_MAX_TOKENS - metaTokens;

    if (remainingBudget <= 10) {
      // Metadata alone fills the budget — just embed the metadata
      return this.truncateToTokenLimit(tokenizer, metaText, EFFECTIVE_MAX_TOKENS);
    }

    // Fill remaining token budget with code content
    const codeText = this.truncateToTokenLimit(tokenizer, chunk.content, remainingBudget);

    return `${metaText}\n${codeText}`;
  }

  /**
   * Format a chunk for embedding (sync version using char estimate).
   * Used as a fast path when tokenizer isn't needed.
   */
  public formatChunkSync(chunk: Chunk): string {
    const metaParts: string[] = [];
    metaParts.push(`[${chunk.language}] ${chunk.kind}: ${chunk.symbolPath}`);

    if (chunk.signature) {
      metaParts.push(`sig: ${chunk.signature}`);
    }

    if (chunk.dependencies.length > 0) {
      const topDeps = chunk.dependencies.slice(0, 8).join(", ");
      metaParts.push(`deps: ${topDeps}`);
    }

    if (chunk.parent) {
      metaParts.push(`parent: ${chunk.parent}`);
    }

    const metaText = metaParts.join(" | ");

    // Estimate: ~4 chars per token for code
    const metaCharEstimate = metaText.length;
    const totalCharBudget = EFFECTIVE_MAX_TOKENS * 4;
    const remainingChars = Math.max(50, totalCharBudget - metaCharEstimate);

    const codeText = chunk.content.length <= remainingChars
      ? chunk.content
      : chunk.content.slice(0, remainingChars);

    return `${metaText}\n${codeText}`;
  }

  /**
   * Embed an array of chunks using batch inference.
   */
  public async embedChunks(chunks: Chunk[]): Promise<number[][]> {
    if (chunks.length === 0) return [];

    // Use sync formatting for batch performance
    const formattedTexts = chunks.map(c => this.formatChunkSync(c));
    const extractor = await this.extractorPromise;

    const output = await extractor(formattedTexts, { pooling: 'mean', normalize: true });

    return output.tolist() as number[][];
  }

  /**
   * Get the embedding dimension of the model.
   */
  public getDimensions(): number {
    // MiniLM-L6-v2 outputs 384-dimensional embeddings
    return 384;
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  private countTokens(tokenizer: PreTrainedTokenizer, text: string): number {
    try {
      const encoded = tokenizer.encode(text);
      return encoded.length;
    } catch {
      // Fallback: estimate 4 chars per token
      return Math.ceil(text.length / 4);
    }
  }

  private truncateToTokenLimit(tokenizer: PreTrainedTokenizer, text: string, maxTokens: number): string {
    try {
      const encoded = tokenizer.encode(text);
      if (encoded.length <= maxTokens) return text;

      // Truncate token IDs and decode back
      const truncated = encoded.slice(0, maxTokens);
      return tokenizer.decode(truncated, { skip_special_tokens: true });
    } catch {
      // Fallback: character-based truncation
      const maxChars = maxTokens * 4;
      return text.length <= maxChars ? text : text.slice(0, maxChars);
    }
  }
}
