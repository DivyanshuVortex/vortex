import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { getParserRegistry } from "./parsers/parser-registry";
import { FileClassification } from "./types";

// ─────────────────────────────────────────────
// Chunk Types
// ─────────────────────────────────────────────

export type ChunkKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "block"
  | "module"
  | "import";

export interface Chunk {
  id: string;

  file: string;
  language: string;

  name: string;
  symbolPath: string;

  kind: ChunkKind;

  parent?: string;
  /** ID of the parent chunk (for hierarchical retrieval) */
  parentId?: string;

  isExported: boolean;
  isAsync: boolean;

  signature?: string;

  dependencies: string[];

  startLine: number;
  endLine: number;

  hash: string;

  content: string;
}

// ─────────────────────────────────────────────
// Main chunking function
// ─────────────────────────────────────────────

/**
 * Parse a source file into semantic chunks.
 *
 * Dispatches to the appropriate language parser via the ParserRegistry.
 * Falls back to the fallback parser (sliding-window) if no language-specific
 * parser is available or if the primary parser fails.
 *
 * @param filePath - Absolute path to the file
 * @param classification - Optional file classification to guide parsing strategy
 * @returns Array of chunks extracted from the file
 */
export function chunkFile(
  filePath: string,
  classification?: FileClassification,
): Chunk[] {
  // If classification says skip, return empty
  if (classification && !classification.shouldIndex) {
    return [];
  }

  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  if (source.trim().length === 0) {
    return [];
  }

  const registry = getParserRegistry();
  return registry.parse(filePath, source);
}

// ─────────────────────────────────────────────
// Utility (preserved for backward compatibility)
// ─────────────────────────────────────────────

/**
 * Compute a content hash for change detection.
 * Normalizes whitespace before hashing.
 */
export function computeContentHash(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(normalized).digest("hex");
}