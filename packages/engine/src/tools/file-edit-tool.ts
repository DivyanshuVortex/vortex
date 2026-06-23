import * as fs from "fs";
import * as path from "path";
import { AgentTool, ApprovalCallback } from "./tool-types";
import { VectorStore, LocalEmbedder, chunkFile, BM25Index } from "@vortex/retrieval";

/**
 * FileEditTool — Modifies an existing file by replacing a specific block of text.
 *
 * Agents use this to mutate the file system with precise, targeted changes instead of full rewrites.
 * If RAG components are provided, it automatically indexes the written file.
 */
export class FileEditTool implements AgentTool {
  name = "replace_in_file";
  description =
    'Replace a specific block of text in a file. Args: {"path": "relative file path", "target": "exact string to replace", "replacement": "new string to insert"}. The target MUST exactly match the file contents, including indentation.';

  private cwd: string;
  private vectorStore?: VectorStore;
  private embedder?: LocalEmbedder;
  private bm25Index?: BM25Index;
  private approvalCallback?: ApprovalCallback;

  constructor(cwd?: string, vectorStore?: VectorStore, embedder?: LocalEmbedder, bm25Index?: BM25Index, approvalCallback?: ApprovalCallback) {
    this.cwd = cwd || process.cwd();
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.bm25Index = bm25Index;
    this.approvalCallback = approvalCallback;
  }

  async execute(args: Record<string, string>): Promise<string> {
    const filePath = args.path;
    const target = args.target;
    const replacement = args.replacement;
    
    if (!filePath) {
      return "Error: 'path' argument is required.";
    }
    if (target === undefined) {
      return "Error: 'target' argument is required.";
    }
    if (replacement === undefined) {
      return "Error: 'replacement' argument is required.";
    }

    // Resolve to absolute path within the workspace
    const absolutePath = path.resolve(this.cwd, filePath);

    // Security: prevent path traversal outside the workspace
    if (!absolutePath.startsWith(this.cwd)) {
      return "Error: Cannot edit files outside the workspace directory.";
    }

    // Security: block sensitive files
    const basename = path.basename(absolutePath);
    if (basename.startsWith(".env") || basename === ".vortexenv") {
      return "Error: Cannot edit environment/secret files.";
    }

    if (!fs.existsSync(absolutePath)) {
      return `Error: File ${filePath} does not exist. Use write_file to create it.`;
    }

    if (this.approvalCallback) {
      const approved = await this.approvalCallback("replace_in_file", filePath);
      if (!approved) {
        return "Error: User denied editing this file.";
      }
    }

    try {
      const originalContent = fs.readFileSync(absolutePath, "utf8");
      
      const occurrences = originalContent.split(target).length - 1;
      
      if (occurrences === 0) {
        return "Error: The exact 'target' string was not found in the file. Ensure you matched indentation and formatting perfectly.";
      }
      
      if (occurrences > 1) {
        return `Error: The 'target' string was found ${occurrences} times in the file. The target must be unique to avoid accidental replacements of the wrong block.`;
      }

      const newContent = originalContent.replace(target, replacement);
      
      fs.writeFileSync(absolutePath, newContent, "utf8");
      
      let ragMessage = "";
      // RAG Synchronization: Index the newly written file
      if (this.vectorStore && this.embedder) {
        try {
          const oldIds = await this.vectorStore.getIdsByFile(absolutePath);
          if (oldIds.length > 0) {
            await this.vectorStore.deleteByFile(absolutePath);
            if (this.bm25Index) {
              this.bm25Index.removeDocuments(oldIds);
            }
          }

          const chunks = chunkFile(absolutePath);
          if (chunks.length > 0) {
            const embeddings = await this.embedder.embedChunks(chunks);
            await this.vectorStore.upsert(chunks, embeddings);
            if (this.bm25Index) {
              this.bm25Index.addDocuments(chunks);
              const bm25Path = path.join(this.cwd, ".vortex-bm25.json");
              fs.writeFileSync(bm25Path, JSON.stringify(this.bm25Index.exportIndex()));
            }
            ragMessage = " (Successfully synced to Project Memory/RAG)";
          }
        } catch (ragErr: any) {
          ragMessage = ` (Warning: Failed to sync to RAG: ${ragErr.message})`;
        }
      }

      return `Success: Replaced target block in ${filePath} successfully.${ragMessage}`;
    } catch (err: any) {
      return `Error editing file: ${err.message}`;
    }
  }
}
