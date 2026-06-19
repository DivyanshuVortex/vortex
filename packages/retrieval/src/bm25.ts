import MiniSearch from "minisearch";
import { Chunk } from "./chunker";

/**
 * BM25-based keyword search index using MiniSearch.
 *
 * This provides exact keyword matching for function names, class names,
 * and variable identifiers that dense vector embeddings often miss.
 *
 * Example: A query for "calculateMaxOffset" will rank the exact function
 *          definition far higher than a semantically-similar but differently-named function.
 */

export interface BM25Document {
  id: string;
  name: string;
  symbolPath: string;
  file: string;
  content: string;
  kind: string;
}

export interface BM25SearchResult {
  id: string;
  score: number;
  match: Record<string, string[]>;
}

export class BM25Index {
  private index: MiniSearch<BM25Document>;

  constructor() {
    this.index = new MiniSearch<BM25Document>({
      fields: ["name", "symbolPath", "content", "file"],
      storeFields: ["name", "symbolPath", "file", "kind"],
      // Tokenizer: split on whitespace, dots, underscores, camelCase boundaries
      tokenize: (text: string) => {
        return text
          // Insert space before uppercase letters in camelCase
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          // Split on non-alphanumeric characters
          .split(/[\s\W_]+/)
          .filter((token) => token.length > 1)
          .map((token) => token.toLowerCase());
      },
    });
  }

  /**
   * Adds an array of Chunks to the BM25 index.
   * Chunks are converted to BM25Documents with relevant fields for keyword search.
   */
  public addDocuments(chunks: Chunk[]): void {
    const documents: BM25Document[] = chunks.map((chunk) => ({
      id: chunk.id,
      name: chunk.name,
      symbolPath: chunk.symbolPath,
      file: chunk.file,
      content: chunk.content,
      kind: chunk.kind,
    }));

    // MiniSearch throws if a document with the same ID already exists,
    // so we discard duplicates silently.
    const existingIds = new Set(
      this.index.documentCount > 0
        ? // MiniSearch doesn't expose a simple "has" check, so we track externally
          []
        : []
    );

    for (const doc of documents) {
      try {
        this.index.add(doc);
      } catch {
        // Document with this ID already exists — skip it
      }
    }
  }

  /**
   * Removes all documents and rebuilds the index from the given chunks.
   * Use this during `vortex init --reindex`.
   */
  public rebuild(chunks: Chunk[]): void {
    this.index.removeAll();
    this.addDocuments(chunks);
  }

  /**
   * Performs a BM25 keyword search over the indexed documents.
   *
   * @param query - The search query string
   * @param limit - Maximum number of results to return (default: 20)
   * @returns Array of search results with scores and match details
   */
  public search(query: string, limit: number = 20): BM25SearchResult[] {
    const results = this.index.search(query, {
      // Use prefix matching to handle partial queries (e.g., "calc" → "calculateMaxOffset")
      prefix: true,
      // Fuzzy matching tolerance for typos (1 character edit distance)
      fuzzy: 0.2,
      // Combine field scores using the sum (default is sum, but being explicit)
      combineWith: "OR",
      // Boost function/symbol names much higher than raw content
      boost: {
        name: 5,
        symbolPath: 3,
        file: 1,
        content: 1,
      },
    });

    return results.slice(0, limit).map((result) => ({
      id: result.id as string,
      score: result.score,
      match: result.match,
    }));
  }

  /**
   * Returns the number of documents currently in the index.
   */
  public get documentCount(): number {
    return this.index.documentCount;
  }

  /**
   * Exports the index to a JSON-serializable object for persistence.
   */
  public exportIndex(): any {
    return this.index.toJSON();
  }

  /**
   * Imports a previously exported index, replacing the current one.
   */
  public importIndex(data: any): void {
    this.index = MiniSearch.loadJSON<BM25Document>(JSON.stringify(data), {
      fields: ["name", "symbolPath", "content", "file"],
      storeFields: ["name", "symbolPath", "file", "kind"],
      tokenize: (text: string) => {
        return text
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .split(/[\s\W_]+/)
          .filter((token) => token.length > 1)
          .map((token) => token.toLowerCase());
      },
    });
  }
}
