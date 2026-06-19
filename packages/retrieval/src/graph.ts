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
  public async generateMermaidGraph(file?: string, detailed?: boolean): Promise<string> {
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

    const isDetailed = detailed || !!file;

    const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_]/g, "_");

    if (!isDetailed) {
      // File-level graph
      let mermaid = "flowchart LR\n";
      const files = Array.from(new Set(chunks.map(c => c.file))).sort();
      
      // Find common prefix to make paths relative
      let commonPrefix: string = files.length > 0 ? files[0]! : "";
      for (const f of files) {
        let i = 0;
        while (i < commonPrefix.length && i < f.length && commonPrefix[i] === f[i]) {
          i++;
        }
        commonPrefix = commonPrefix.slice(0, i);
      }
      const lastSlash = commonPrefix.lastIndexOf('/');
      if (lastSlash !== -1) {
        commonPrefix = commonPrefix.substring(0, lastSlash + 1);
      }

      // Build tree
      interface DirNode {
        name: string;
        files: string[];
        dirs: Record<string, DirNode>;
      }
      const rootNode: DirNode = { name: "root", files: [], dirs: {} };

      for (const f of files) {
        const relPath = f.replace(commonPrefix, "");
        const parts = relPath.split("/");
        const fileName = parts.pop()!;
        
        let current = rootNode;
        for (const dir of parts) {
          if (!current.dirs[dir]) {
            current.dirs[dir] = { name: dir, files: [], dirs: {} };
          }
          current = current.dirs[dir];
        }
        current.files.push(f);
      }

      const colors = ["#2C3E50", "#27AE60", "#2980B9", "#8E44AD", "#D35400", "#C0392B"];

      const renderNode = (node: DirNode, depth: number, pathPrefix: string): string => {
        let result = "";
        const indent = "  ".repeat(depth);
        const color = colors[depth % colors.length];
        
        for (const [dirName, childNode] of Object.entries(node.dirs)) {
          const sgId = sanitize(pathPrefix + dirName);
          result += `${indent}subgraph ${sgId}["${dirName}"]\n`;
          result += `${indent}  style ${sgId} fill:${color},stroke:#ecf0f1,stroke-width:2px,color:#fff,rx:5,ry:5\n`;
          result += renderNode(childNode, depth + 1, pathPrefix + dirName + "_");
          result += `${indent}end\n`;
        }
        
        for (const file of node.files) {
          const shortFile = file.split("/").pop() || file;
          const fileId = sanitize(file);
          result += `${indent}  ${fileId}["${shortFile}"]\n`;
          result += `${indent}  style ${fileId} fill:#34495E,stroke:#BDC3C7,stroke-width:1px,color:#fff,rx:3,ry:3\n`;
        }
        
        return result;
      };

      mermaid += renderNode(rootNode, 1, "dir_");

      const writtenEdges = new Set<string>();

      for (const chunk of chunks) {
        const callerFileId = sanitize(chunk.file);

        for (const dep of chunk.dependencies) {
          const callee = chunks.find(c => c.name === dep || c.symbolPath === dep);
          if (callee && callee.file !== chunk.file) {
            const calleeFileId = sanitize(callee.file);
            const edgeKey = `${callerFileId}->${calleeFileId}`;
            
            if (!writtenEdges.has(edgeKey)) {
              if (chunk.file.includes("components") || callee.file.includes("components")) {
                mermaid += `  ${callerFileId} ==>|component| ${calleeFileId}\n`;
              } else {
                mermaid += `  ${callerFileId} --> ${calleeFileId}\n`;
              }
              writtenEdges.add(edgeKey);
            }
          }
        }
      }

      return mermaid;
    }

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
    
    let mermaid = "flowchart LR\n";

    // Group chunks by file to create subgraphs
    const chunksByFile = new Map<string, any[]>();
    for (const chunk of chunks) {
      if (!isNodeIncluded(chunk.id)) continue;
      const fileArr = chunksByFile.get(chunk.file) || [];
      fileArr.push(chunk);
      chunksByFile.set(chunk.file, fileArr);
    }

    const writtenNodes = new Set<string>();
    
    for (const [filePath, fileChunks] of chunksByFile.entries()) {
      const shortFile = filePath.split("/").pop() || filePath;
      const subgraphId = sanitize(filePath);
      
      mermaid += `  subgraph ${subgraphId}["${shortFile}"]\n`;
      
      for (const chunk of fileChunks) {
        const nodeId = sanitize(chunk.symbolPath || chunk.name || chunk.id);
        const nodeText = chunk.symbolPath || chunk.name;
        
        if (!writtenNodes.has(nodeId)) {
          mermaid += `    ${nodeId}["${nodeText}"]\n`;
          writtenNodes.add(nodeId);
        }
      }
      mermaid += `  end\n`;
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
