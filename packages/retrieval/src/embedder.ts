import { Chunk } from "./chunker";
import { pipeline, env, FeatureExtractionPipeline } from '@xenova/transformers';

// Configure transformers to only cache models locally and suppress unnecessary warnings
env.allowLocalModels = true;
env.useBrowserCache = false;

export class LocalEmbedder {
  private extractorPromise: Promise<FeatureExtractionPipeline>;

  constructor() {
    // Start loading the model in the background immediately
    // If it's the first run, this will automatically download the 22MB model to ~/.cache/huggingface
    this.extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    }) as Promise<FeatureExtractionPipeline>;
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
    const extractor = await this.extractorPromise;
    
    // Xenova/transformers processes arrays very efficiently in C++/WASM
    const output = await extractor(formattedTexts, { pooling: 'mean', normalize: true });
    
    // output.tolist() returns number[][] when multiple texts are passed
    return output.tolist() as number[][];
  }
}
