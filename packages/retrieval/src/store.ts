import { prisma } from "@vortex/db";
import { cosineSimilarity } from "@vortex/shared";
import { Chunk, ChunkKind } from "./chunker";

export interface SearchFilter {
  file?: string;
  kind?: ChunkKind;
}

export class VectorStore {
  constructor() {}

  public async upsert(chunks: Chunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length === 0 || chunks.length !== embeddings.length) {
      throw new Error("Chunks and embeddings length mismatch or empty.");
    }

    // Upsert to local SQLite using Prisma
    // We stringify dependencies and embedding
    await prisma.$transaction(
      chunks.map((chunk, i) => 
        prisma.chunk.upsert({
          where: { id: chunk.id },
          update: {
            file: chunk.file,
            language: chunk.language,
            name: chunk.name,
            symbolPath: chunk.symbolPath,
            kind: chunk.kind,
            parent: chunk.parent || null,
            isExported: chunk.isExported,
            isAsync: chunk.isAsync,
            signature: chunk.signature || null,
            dependencies: JSON.stringify(chunk.dependencies),
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            hash: chunk.hash,
            content: chunk.content,
            embedding: JSON.stringify(embeddings[i])
          },
          create: {
            id: chunk.id,
            file: chunk.file,
            language: chunk.language,
            name: chunk.name,
            symbolPath: chunk.symbolPath,
            kind: chunk.kind,
            parent: chunk.parent || null,
            isExported: chunk.isExported,
            isAsync: chunk.isAsync,
            signature: chunk.signature || null,
            dependencies: JSON.stringify(chunk.dependencies),
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            hash: chunk.hash,
            content: chunk.content,
            embedding: JSON.stringify(embeddings[i])
          }
        })
      )
    );
  }

  public async search(queryEmbedding: number[], limit: number = 5, filter?: SearchFilter): Promise<Chunk[]> {
    // 1. Fetch chunks matching the metadata filters
    const whereClause: any = {};
    if (filter?.file) {
      whereClause.file = filter.file;
    }
    if (filter?.kind) {
      whereClause.kind = filter.kind;
    }

    const dbChunks = await prisma.chunk.findMany({
      where: whereClause,
      select: {
        id: true,
        file: true,
        language: true,
        name: true,
        symbolPath: true,
        kind: true,
        parent: true,
        isExported: true,
        isAsync: true,
        signature: true,
        dependencies: true,
        startLine: true,
        endLine: true,
        hash: true,
        content: true,
        embedding: true,
      }
    });

    if (dbChunks.length === 0) return [];

    // 2. Perform in-memory cosine similarity search
    const scoredChunks = dbChunks.map((dbChunk: any) => {
      let similarity = -1;
      if (dbChunk.embedding) {
        try {
          const chunkEmbedding = JSON.parse(dbChunk.embedding) as number[];
          similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
        } catch(e) {
            // Ignore parse errors, score remains -1
        }
      }

      // Reconstruct Chunk format
      const chunk: Chunk = {
          id: dbChunk.id,
          file: dbChunk.file,
          language: dbChunk.language,
          name: dbChunk.name,
          symbolPath: dbChunk.symbolPath,
          kind: dbChunk.kind as ChunkKind,
          parent: dbChunk.parent || undefined,
          isExported: dbChunk.isExported,
          isAsync: dbChunk.isAsync,
          signature: dbChunk.signature || undefined,
          dependencies: JSON.parse(dbChunk.dependencies) as string[],
          startLine: dbChunk.startLine,
          endLine: dbChunk.endLine,
          hash: dbChunk.hash,
          content: dbChunk.content
      };

      return { chunk, similarity };
    });

    // 3. Sort by descending similarity and return top results
    scoredChunks.sort((a: any, b: any) => b.similarity - a.similarity);
    
    return scoredChunks.slice(0, limit).map((item: any) => ({
      ...item.chunk,
      score: item.similarity
    }));
  }
}
