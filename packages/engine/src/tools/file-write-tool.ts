import * as fs from "fs";
import * as path from "path";
import { AgentTool, ApprovalCallback } from "./tool-types";
import { VectorStore, LocalEmbedder, chunkFile } from "@vortex/retrieval";

/**
 * FileWriteTool — Writes a file to the local codebase.
 *
 * Agents use this to mutate the file system (create or modify files).
 * If RAG components are provided, it automatically indexes the written file.
 */
export class FileWriteTool implements AgentTool {
  name = "write_file";
  description =
    'Write the contents to a file in the codebase. Args: {"path": "relative file path", "content": "file contents"}. Returns success or error message.';

  private cwd: string;
  private vectorStore?: VectorStore;
  private embedder?: LocalEmbedder;
  private approvalCallback?: ApprovalCallback;

  constructor(cwd?: string, vectorStore?: VectorStore, embedder?: LocalEmbedder, approvalCallback?: ApprovalCallback) {
    this.cwd = cwd || process.cwd();
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.approvalCallback = approvalCallback;
  }

  async execute(args: Record<string, string>): Promise<string> {
    const filePath = args.path;
    const content = args.content;
    
    if (!filePath) {
      return "Error: 'path' argument is required.";
    }
    if (content === undefined) {
      return "Error: 'content' argument is required.";
    }

    // Resolve to absolute path within the workspace
    const absolutePath = path.resolve(this.cwd, filePath);

    // Security: prevent path traversal outside the workspace
    if (!absolutePath.startsWith(this.cwd)) {
      return "Error: Cannot write files outside the workspace directory.";
    }

    // Security: block sensitive files
    const basename = path.basename(absolutePath);
    if (basename.startsWith(".env") || basename === ".vortexenv") {
      return "Error: Cannot write to environment/secret files.";
    }

    if (this.approvalCallback) {
      const approved = await this.approvalCallback("write_file", filePath);
      if (!approved) {
        return "Error: User denied writing to this file.";
      }
    }

    try {
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Rollback mechanism: Backup existing file before overwrite
      if (fs.existsSync(absolutePath)) {
        const backupDir = path.join(this.cwd, ".vortex_backup");
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = path.join(backupDir, `${timestamp}_${basename}`);
        fs.copyFileSync(absolutePath, backupPath);
      }
      
      fs.writeFileSync(absolutePath, content, "utf8");
      
      let ragMessage = "";
      // RAG Synchronization: Index the newly written file
      if (this.vectorStore && this.embedder) {
        try {
          const chunks = chunkFile(absolutePath);
          if (chunks.length > 0) {
            const embeddings = await this.embedder.embedChunks(chunks);
            await this.vectorStore.upsert(chunks, embeddings);
            ragMessage = " (Successfully synced to Project Memory/RAG)";
          }
        } catch (ragErr: any) {
          ragMessage = ` (Warning: Failed to sync to RAG: ${ragErr.message})`;
        }
      }

      return `Success: Wrote to ${filePath} successfully.${ragMessage}`;
    } catch (err: any) {
      return `Error writing file: ${err.message}`;
    }
  }
}
