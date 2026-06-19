import { prisma } from "@vortex/db";
import { Chunk, ChunkKind } from "./chunker";
import { ScoredChunk } from "./reranker";

export class GraphRetriever {
  // Retrieves dependencies and dependents for given chunks.
  public async getNeighbors(
    chunks: Chunk[],
    maxNeighbors: number = 10
  ): Promise<ScoredChunk[]> {
    if (chunks.length === 0) return [];

    const names = chunks.map((c) => c.name).filter(Boolean);
    const symbolPaths = chunks.map((c) => c.symbolPath).filter(Boolean);
    const allIdentifiers = Array.from(new Set([...names, ...symbolPaths]));

    if (allIdentifiers.length === 0) return [];

    // Combine all dependencies of focal chunks to find what they depend on
    const focalDependencies = new Set<string>();
    for (const chunk of chunks) {
      if (Array.isArray(chunk.dependencies)) {
        for (const dep of chunk.dependencies) {
          focalDependencies.add(dep);
        }
      }
    }

    const depArray = Array.from(focalDependencies);

    // 1. Find chunks that the focal chunks depend on (Dependencies)
    const dependencies = await prisma.chunk.findMany({
      where: {
        OR: [
          { name: { in: depArray } },
          { symbolPath: { in: depArray } },
        ],
      },
      take: maxNeighbors,
    });

    // 2. Find chunks that depend on the focal chunks (Dependents)
    // We use Prisma's contains to search the JSON string for any identifier
    const dependentConditions = allIdentifiers.map((identifier) => ({
      dependencies: {
        contains: `"${identifier}"`,
      },
    }));

    const dependents = await prisma.chunk.findMany({
      where: {
        OR: dependentConditions,
      },
      take: maxNeighbors,
    });

    // Merge and deduplicate
    const neighborMap = new Map<string, any>();
    
    for (const dbChunk of [...dependencies, ...dependents]) {
      // Don't include focal chunks themselves
      if (chunks.some((c) => c.id === dbChunk.id)) continue;
      
      if (!neighborMap.has(dbChunk.id)) {
        neighborMap.set(dbChunk.id, dbChunk);
      }
    }

    const neighbors = Array.from(neighborMap.values()).slice(0, maxNeighbors);

    // Map to ScoredChunk format
    return neighbors.map((dbChunk) => {
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
        content: dbChunk.content,
      };

      return {
        chunk,
        score: 0.5, // Base score for graph neighbors
        source: "graph" as any, 
      };
    });
  }

  // Generates Mermaid JS dependency graph.
  public async generateMermaidGraph(file?: string): Promise<string> {
    const allDbChunks = await prisma.chunk.findMany({
      select: {
        id: true,
        file: true,
        name: true,
        symbolPath: true,
        dependencies: true,
      },
    });

    const chunks = allDbChunks.map(c => ({
      ...c,
      dependencies: JSON.parse(c.dependencies) as string[]
    }));

    // Find nodes matching the file filter
    const targetNodes = new Set<string>();
    
    if (file) {
      for (const chunk of chunks) {
        if (chunk.file.includes(file)) {
          targetNodes.add(chunk.id);
        }
      }

      // Add neighbors to the target nodes
      for (const chunk of chunks) {
        if (targetNodes.has(chunk.id)) {
          // Add dependencies of the target node
          for (const dep of chunk.dependencies) {
            const depMatch = chunks.find(c => c.name === dep || c.symbolPath === dep);
            if (depMatch) {
              targetNodes.add(depMatch.id);
            }
          }
        } else {
          // Add dependents of the target node
          const dependsOnTarget = chunk.dependencies.some(dep => 
            Array.from(targetNodes).some(targetId => {
              const tc = chunks.find(c => c.id === targetId);
              return tc && (tc.name === dep || tc.symbolPath === dep);
            })
          );
          if (dependsOnTarget) {
            targetNodes.add(chunk.id);
          }
        }
      }
    }

    const isNodeIncluded = (id: string) => !file || targetNodes.has(id);
    const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_]/g, "_");
    
    let mermaid = "flowchart TD\n";

    // Add node definitions
    const writtenNodes = new Set<string>();
    
    for (const chunk of chunks) {
      if (!isNodeIncluded(chunk.id)) continue;

      const nodeId = sanitize(chunk.symbolPath || chunk.name || chunk.id);
      
      // Use filename as a hint in the node text
      const shortFile = chunk.file.split("/").pop() || "";
      const nodeText = `${chunk.symbolPath || chunk.name} (${shortFile})`;
      
      if (!writtenNodes.has(nodeId)) {
        mermaid += `  ${nodeId}["${nodeText}"]\n`;
        writtenNodes.add(nodeId);
      }
    }

    // Add edges
    const writtenEdges = new Set<string>();

    for (const chunk of chunks) {
      if (!isNodeIncluded(chunk.id)) continue;

      const callerId = sanitize(chunk.symbolPath || chunk.name || chunk.id);

      for (const dep of chunk.dependencies) {
        const callee = chunks.find(c => c.name === dep || c.symbolPath === dep);
        if (callee && isNodeIncluded(callee.id)) {
          const calleeId = sanitize(callee.symbolPath || callee.name || callee.id);
          const edgeKey = `${callerId}->${calleeId}`;
          
          if (!writtenEdges.has(edgeKey)) {
            mermaid += `  ${callerId} --> ${calleeId}\n`;
            writtenEdges.add(edgeKey);
          }
        }
      }
    }

    return mermaid;
  }

  // Generates ASCII tree dependency visualization.
  public async generateAsciiTree(file?: string): Promise<string> {
    const allDbChunks = await prisma.chunk.findMany({
      select: {
        id: true,
        file: true,
        name: true,
        symbolPath: true,
        dependencies: true,
      },
    });

    const chunks = allDbChunks.map(c => ({
      ...c,
      dependencies: JSON.parse(c.dependencies) as string[]
    }));

    if (!file) {
      // For the whole project, just list files and their top-level symbols
      let tree = "📦 Project Dependencies\n";
      const files = Array.from(new Set(chunks.map(c => c.file))).sort();
      
      files.forEach((f, i) => {
        const isLastFile = i === files.length - 1;
        tree += isLastFile ? `└── 📄 ${f.split('/').pop()}\n` : `├── 📄 ${f.split('/').pop()}\n`;
        
        const fileChunks = chunks.filter(c => c.file === f);
        fileChunks.forEach((c, j) => {
          const isLastChunk = j === fileChunks.length - 1;
          const prefix = isLastFile ? "    " : "│   ";
          tree += prefix + (isLastChunk ? "└── " : "├── ") + `${c.symbolPath || c.name}\n`;
        });
      });
      return tree;
    }

    // For a specific file, show target nodes, dependencies, and dependents
    const targetNodes = chunks.filter(c => c.file.includes(file));
    if (targetNodes.length === 0) return `No chunks found for file: ${file}`;

    const shortFile = targetNodes[0]!.file.split('/').pop() || file;
    let tree = `🎯 Target: ${shortFile}\n`;

    for (let i = 0; i < targetNodes.length; i++) {
      const target = targetNodes[i]!;
      const isLastTarget = i === targetNodes.length - 1;
      tree += (isLastTarget ? "└── " : "├── ") + `${target.symbolPath || target.name}\n`;

      const prefix = isLastTarget ? "    " : "│   ";

      // Find Dependencies (Callees)
      const dependencies = target.dependencies.map(dep => 
        chunks.find(c => c.name === dep || c.symbolPath === dep)
      ).filter(Boolean) as any[];

      // Find Dependents (Callers)
      const dependents = chunks.filter(c => 
        c.dependencies.some(dep => dep === target.name || dep === target.symbolPath)
      );

      tree += prefix + `├── Dependencies (${dependencies.length})\n`;
      dependencies.forEach((d, j) => {
        const isLastDep = j === dependencies.length - 1;
        tree += prefix + "│   " + (isLastDep ? "└── " : "├── ") + `${d.symbolPath || d.name} (${d.file.split('/').pop()})\n`;
      });

      tree += prefix + `└── Dependents (${dependents.length})\n`;
      dependents.forEach((d, j) => {
        const isLastDep = j === dependents.length - 1;
        tree += prefix + "    " + (isLastDep ? "└── " : "├── ") + `${d.symbolPath || d.name} (${d.file.split('/').pop()})\n`;
      });
    }

    return tree;
  }
}
