import * as path from "path";
import { Chunk } from "../chunker";
import { TypeScriptParser } from "./typescript-parser";
import { createTreeSitterParsers } from "./tree-sitter-parser";
import { FallbackParser } from "./fallback-parser";

/**
 * Interface that all language parsers implement.
 * Each parser knows how to extract semantic chunks from source code
 * in the languages it supports.
 */
export interface LanguageParser {
  /** Human-readable parser name (e.g., "TypeScript", "TreeSitter-Python") */
  readonly name: string;
  /** File extensions this parser handles (e.g., [".ts", ".tsx"]) */
  readonly extensions: string[];
  /**
   * Parse a source file into semantic chunks.
   *
   * @param filePath - Absolute path to the file
   * @param source - The file's source code content
   * @returns Array of chunks extracted from the file
   */
  parse(filePath: string, source: string): Chunk[];
}

/**
 * ParserRegistry manages language parsers and dispatches
 * file parsing to the appropriate parser based on file extension.
 */
export class ParserRegistry {
  private parsers: LanguageParser[] = [];
  private extensionMap: Map<string, LanguageParser> = new Map();
  private fallbackParser: LanguageParser | null = null;

  /**
   * Register a parser. If a parser for the same extension already exists,
   * the new one takes precedence.
   */
  register(parser: LanguageParser): void {
    this.parsers.push(parser);
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext.toLowerCase(), parser);
    }
  }

  /**
   * Register a fallback parser that handles files with no
   * matching extension-specific parser.
   */
  registerFallback(parser: LanguageParser): void {
    this.fallbackParser = parser;
  }

  /**
   * Get the parser for a given file path based on its extension.
   * Returns the fallback parser if no specific parser is registered.
   */
  getParser(filePath: string): LanguageParser | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.extensionMap.get(ext) ?? this.fallbackParser;
  }

  /**
   * Parse a file using the appropriate parser.
   * Returns empty array if no parser can handle the file.
   */
  parse(filePath: string, source: string): Chunk[] {
    const parser = this.getParser(filePath);
    if (!parser) {
      return [];
    }

    try {
      return parser.parse(filePath, source);
    } catch (err) {
      console.warn(`[ParserRegistry] ${parser.name} failed on ${filePath}:`, err);
      // Fall back to fallback parser if the primary parser throws
      if (parser !== this.fallbackParser && this.fallbackParser) {
        try {
          return this.fallbackParser.parse(filePath, source);
        } catch (fallbackErr) {
          console.warn(`[ParserRegistry] Fallback parser also failed on ${filePath}:`, fallbackErr);
        }
      }
      return [];
    }
  }

  /**
   * List all registered parsers and their extensions.
   */
  listParsers(): Array<{ name: string; extensions: string[] }> {
    return this.parsers.map(p => ({ name: p.name, extensions: p.extensions }));
  }
}

// ─────────────────────────────────────────────
// Singleton registry
// ─────────────────────────────────────────────

let _registry: ParserRegistry | null = null;

/**
 * Returns the global parser registry, lazily initialized
 * with all available parsers.
 */
export function getParserRegistry(): ParserRegistry {
  if (_registry) return _registry;

  _registry = new ParserRegistry();

  _registry.register(new TypeScriptParser());

  // Register tree-sitter parsers for other languages
  try {
    const treeSitterParsers = createTreeSitterParsers();
    for (const parser of treeSitterParsers) {
      _registry.register(parser);
    }
  } catch (err) {
    console.warn("[ParserRegistry] tree-sitter not available, non-TS languages will use fallback parser:", (err as Error).message);
  }

  // Register fallback parser
  _registry.registerFallback(new FallbackParser());

  return _registry;
}

/**
 * Reset the registry (useful for testing).
 */
export function resetParserRegistry(): void {
  _registry = null;
}
