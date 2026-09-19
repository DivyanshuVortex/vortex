import { prisma } from "@vortex/db";
import { Chunk, ChunkKind } from "./chunker";
import { ScoredChunk } from "./types";

// ─────────────────────────────────────────────
// Distance-weighted graph scores
// ─────────────────────────────────────────────

/** Direct dependency: this chunk calls that chunk */
const DIRECT_DEP_SCORE = 0.7;
/** Reverse dependency: that chunk calls this chunk */
const REVERSE_DEP_SCORE = 0.5;
/** Parent-child relationship */
const PARENT_CHILD_SCORE = 0.8;
/** Same-file sibling */
const SIBLING_SCORE = 0.4;

export class GraphRetriever {
  /**
   * Retrieves dependency and dependent neighbors for given chunks.
   * Scores neighbors based on relationship type and distance
   * instead of a flat 0.5.
   *
   * @param chunks - Focal chunks from primary retrieval
   * @param maxNeighbors - Maximum number of neighbors to return
   */
  public async getNeighbors(
    chunks: Chunk[],
    maxNeighbors: number = 10
  ): Promise<ScoredChunk[]> {
    if (chunks.length === 0) return [];

    // Cap graph expansion to avoid overwhelming primary retrieval
    const effectiveMax = Math.min(maxNeighbors, chunks.length * 2);

    const focalIds = new Set(chunks.map(c => c.id));
    const neighborMap = new Map<string, { dbChunk: any; score: number; relationship: string }>();

    // ── 1. Direct dependencies (chunks our focals call) ──
    const focalDeps = new Set<string>();
    for (const chunk of chunks) {
      if (Array.isArray(chunk.dependencies)) {
        for (const dep of chunk.dependencies) {
          focalDeps.add(dep);
        }
      }
    }

    if (focalDeps.size > 0) {
      const depArray = Array.from(focalDeps);
      const dependencies = await prisma.chunk.findMany({
        where: {
          OR: [
            { name: { in: depArray } },
            { symbolPath: { in: depArray } },
          ],
        },
        take: effectiveMax * 2,
      });

      for (const dbChunk of dependencies) {
        if (focalIds.has(dbChunk.id)) continue;
        const existing = neighborMap.get(dbChunk.id);
        if (!existing || existing.score < DIRECT_DEP_SCORE) {
          neighborMap.set(dbChunk.id, { dbChunk, score: DIRECT_DEP_SCORE, relationship: "dependency" });
        }
      }
    }

    // ── 2. Reverse dependencies (chunks that call our focals) ──
    const names = chunks.map(c => c.name).filter(Boolean);
    const symbolPaths = chunks.map(c => c.symbolPath).filter(Boolean);
    const allIdentifiers = Array.from(new Set([...names, ...symbolPaths]));

    if (allIdentifiers.length > 0) {
      const dependentConditions = allIdentifiers.map(identifier => ({
        dependencies: { contains: `"${identifier}"` },
      }));

      const dependents = await prisma.chunk.findMany({
        where: { OR: dependentConditions },
        take: effectiveMax * 2,
      });

      for (const dbChunk of dependents) {
        if (focalIds.has(dbChunk.id)) continue;
        const existing = neighborMap.get(dbChunk.id);
        if (!existing || existing.score < REVERSE_DEP_SCORE) {
          neighborMap.set(dbChunk.id, { dbChunk, score: REVERSE_DEP_SCORE, relationship: "dependent" });
        }
      }
    }

    // ── 3. Parent-child relationships ──
    const parentIds = chunks.map(c => c.parentId).filter(Boolean) as string[];
    const chunkIds = chunks.map(c => c.id);

    if (parentIds.length > 0) {
      // Get parent chunks
      const parents = await prisma.chunk.findMany({
        where: { id: { in: parentIds } },
        take: effectiveMax,
      });

      for (const dbChunk of parents) {
        if (focalIds.has(dbChunk.id)) continue;
        neighborMap.set(dbChunk.id, { dbChunk, score: PARENT_CHILD_SCORE, relationship: "parent" });
      }
    }

    // Get child chunks of focal chunks
    if (chunkIds.length > 0) {
      try {
        const childConditions = chunkIds.map(id => ({
          parent: { contains: id },
        }));

        // Use a simple query — parentId may not be in schema yet
        const focalNames = chunks.map(c => c.name).filter(Boolean);
        if (focalNames.length > 0) {
          const children = await prisma.chunk.findMany({
            where: { parent: { in: focalNames } },
            take: effectiveMax,
          });

          for (const dbChunk of children) {
            if (focalIds.has(dbChunk.id)) continue;
            const existing = neighborMap.get(dbChunk.id);
            if (!existing || existing.score < PARENT_CHILD_SCORE) {
              neighborMap.set(dbChunk.id, { dbChunk, score: PARENT_CHILD_SCORE, relationship: "child" });
            }
          }
        }
      } catch {
        // parentId column may not exist yet
      }
    }

    // ── 4. Same-file siblings (lower priority) ──
    const focalFiles = Array.from(new Set(chunks.map(c => c.file)));
    if (focalFiles.length > 0 && neighborMap.size < effectiveMax) {
      const siblings = await prisma.chunk.findMany({
        where: { file: { in: focalFiles } },
        take: effectiveMax * 2,
      });

      for (const dbChunk of siblings) {
        if (focalIds.has(dbChunk.id)) continue;
        if (!neighborMap.has(dbChunk.id)) {
          neighborMap.set(dbChunk.id, { dbChunk, score: SIBLING_SCORE, relationship: "sibling" });
        }
      }
    }

    // Sort by score descending and take top neighbors
    const sorted = Array.from(neighborMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, effectiveMax);

    return sorted.map(({ dbChunk, score }) => ({
      chunk: this.dbChunkToChunk(dbChunk),
      score,
      source: "graph" as const,
    }));
  }

  // ─────────────────────────────────────────────
  // Graph Visualization (preserved from original)
  // ─────────────────────────────────────────────

  /** Generates Mermaid JS dependency graph. */
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
      dependencies: JSON.parse(c.dependencies) as string[],
    }));

    const isDetailed = detailed || !!file;
    const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_]/g, "_");

    const shortIds = new Map<string, string>();
    let idCounter = 0;
    const getId = (key: string) => {
      if (!shortIds.has(key)) {
        shortIds.set(key, `n${idCounter++}`);
      }
      return shortIds.get(key)!;
    };

    if (!isDetailed) {
      let mermaid = "flowchart LR\n";
      const files = Array.from(new Set(chunks.map(c => c.file))).sort();

      let commonPrefix: string = files.length > 0 ? files[0]! : "";
      for (const f of files) {
        let i = 0;
        while (i < commonPrefix.length && i < f.length && commonPrefix[i] === f[i]) {
          i++;
        }
        commonPrefix = commonPrefix.slice(0, i);
      }
      const lastSlash = commonPrefix.lastIndexOf("/");
      if (lastSlash !== -1) {
        commonPrefix = commonPrefix.substring(0, lastSlash + 1);
      }

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
          const sgId = getId(pathPrefix + dirName);
          result += `${indent}subgraph ${sgId}["${dirName}"]\n`;
          result += `${indent}  style ${sgId} fill:${color},stroke:#ecf0f1,stroke-width:2px,color:#fff,rx:5,ry:5\n`;
          result += renderNode(childNode, depth + 1, pathPrefix + dirName + "_");
          result += `${indent}end\n`;
        }

        for (const file of node.files) {
          const shortFile = file.split("/").pop() || file;
          const fileId = getId(file);
          result += `${indent}  ${fileId}["${shortFile}"]\n`;
          result += `${indent}  style ${fileId} fill:#34495E,stroke:#BDC3C7,stroke-width:1px,color:#fff,rx:3,ry:3\n`;
        }

        return result;
      };

      mermaid += renderNode(rootNode, 1, "dir_");

      const writtenEdges = new Set<string>();

      for (const chunk of chunks) {
        const callerFileId = getId(chunk.file);

        for (const dep of chunk.dependencies) {
          const callee = chunks.find(c => c.name === dep || c.symbolPath === dep);
          if (callee && callee.file !== chunk.file) {
            const calleeFileId = getId(callee.file);
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

    const targetNodes = new Set<string>();

    if (file) {
      for (const chunk of chunks) {
        if (chunk.file.includes(file)) {
          targetNodes.add(chunk.id);
        }
      }

      for (const chunk of chunks) {
        if (targetNodes.has(chunk.id)) {
          for (const dep of chunk.dependencies) {
            const depMatch = chunks.find(c => c.name === dep || c.symbolPath === dep);
            if (depMatch) {
              targetNodes.add(depMatch.id);
            }
          }
        } else {
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

  /** Generates ASCII tree dependency visualization. */
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
      dependencies: JSON.parse(c.dependencies) as string[],
    }));

    if (!file) {
      let tree = "📦 Project Dependencies\n";
      const files = Array.from(new Set(chunks.map(c => c.file))).sort();

      files.forEach((f, i) => {
        const isLastFile = i === files.length - 1;
        tree += isLastFile ? `└── 📄 ${f.split("/").pop()}\n` : `├── 📄 ${f.split("/").pop()}\n`;

        const fileChunks = chunks.filter(c => c.file === f);
        fileChunks.forEach((c, j) => {
          const isLastChunk = j === fileChunks.length - 1;
          const prefix = isLastFile ? "    " : "│   ";
          tree += prefix + (isLastChunk ? "└── " : "├── ") + `${c.symbolPath || c.name}\n`;
        });
      });
      return tree;
    }

    const targetNodes = chunks.filter(c => c.file.includes(file));
    if (targetNodes.length === 0) return `No chunks found for file: ${file}`;

    const shortFile = targetNodes[0]!.file.split("/").pop() || file;
    let tree = `🎯 Target: ${shortFile}\n`;

    for (let i = 0; i < targetNodes.length; i++) {
      const target = targetNodes[i]!;
      const isLastTarget = i === targetNodes.length - 1;
      tree += (isLastTarget ? "└── " : "├── ") + `${target.symbolPath || target.name}\n`;

      const prefix = isLastTarget ? "    " : "│   ";

      const dependencies = target.dependencies
        .map(dep => chunks.find(c => c.name === dep || c.symbolPath === dep))
        .filter(Boolean) as any[];

      const dependents = chunks.filter(c =>
        c.dependencies.some(dep => dep === target.name || dep === target.symbolPath)
      );

      tree += prefix + `├── Dependencies (${dependencies.length})\n`;
      dependencies.forEach((d, j) => {
        const isLastDep = j === dependencies.length - 1;
        tree += prefix + "│   " + (isLastDep ? "└── " : "├── ") + `${d.symbolPath || d.name} (${d.file.split("/").pop()})\n`;
      });

      tree += prefix + `└── Dependents (${dependents.length})\n`;
      dependents.forEach((d, j) => {
        const isLastDep = j === dependents.length - 1;
        tree += prefix + "    " + (isLastDep ? "└── " : "├── ") + `${d.symbolPath || d.name} (${d.file.split("/").pop()})\n`;
      });
    }

    return tree;
  }

  // ─────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────

  private dbChunkToChunk(dbChunk: any): Chunk {
    return {
      id: dbChunk.id,
      file: dbChunk.file,
      language: dbChunk.language,
      name: dbChunk.name,
      symbolPath: dbChunk.symbolPath,
      kind: dbChunk.kind as ChunkKind,
      parent: dbChunk.parent || undefined,
      parentId: dbChunk.parentId || undefined,
      isExported: dbChunk.isExported,
      isAsync: dbChunk.isAsync,
      signature: dbChunk.signature || undefined,
      dependencies: JSON.parse(dbChunk.dependencies) as string[],
      startLine: dbChunk.startLine,
      endLine: dbChunk.endLine,
      hash: dbChunk.hash,
      content: dbChunk.content,
    };
  }
}
