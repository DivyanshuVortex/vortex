import * as path from "path";
import crypto from "crypto";
import { Chunk, ChunkKind } from "../chunker";
import { LanguageParser } from "./parser-registry";

const FALLBACK_KEYWORD_BLOCKLIST = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof",
  "new", "in", "of", "do", "with", "void", "delete", "yield", "await",
  "else", "try", "finally", "class", "case", "instanceof", "throw",
  "def", "import", "from", "pass", "raise", "except", "lambda",
  "func", "var", "let", "const", "struct", "enum", "type",
  "pub", "fn", "impl", "mod", "use", "mut", "self",
  "public", "private", "protected", "static", "abstract", "final",
  "package", "interface", "extends", "implements",
  "include", "define", "ifdef", "ifndef", "endif", "pragma",
  "int", "float", "double", "char", "bool", "string", "void",
  "true", "false", "null", "nil", "none", "undefined",
  "print", "println", "printf", "fmt",
]);

/**
 * Fallback parser for files that have no language-specific parser.
 *
 * Uses sliding-window chunking with regex-based dependency extraction.
 * This handles documentation, config files, unsupported languages,
 * and malformed files that fail to parse with their primary parser.
 */
export class FallbackParser implements LanguageParser {
  readonly name = "Fallback";
  readonly extensions: string[] = []; // handles everything via fallback

  private readonly WINDOW_SIZE = 100;
  private readonly WINDOW_OVERLAP = 20;

  parse(filePath: string, source: string): Chunk[] {
    if (source.trim().length === 0) {
      return [];
    }

    const filename = path.basename(filePath);
    const basename = path.basename(filePath, path.extname(filePath));
    const language = path.extname(filePath).replace(".", "") || "text";

    // Extract dependencies using language-agnostic regex patterns
    const deps = this.extractDependencies(source);
    const allLines = source.split("\n");

    if (allLines.length <= this.WINDOW_SIZE) {
      // Small file — single chunk
      return [this.createSingleChunk(filePath, filename, basename, language, source, allLines.length, deps)];
    }

    // Large file — split into overlapping windows
    return this.createWindowChunks(filePath, filename, basename, language, allLines, deps);
  }

  private createSingleChunk(
    filePath: string,
    filename: string,
    basename: string,
    language: string,
    source: string,
    lineCount: number,
    deps: string[],
  ): Chunk {
    const hash = this.getHash(source);
    return {
      id: `${filename}:${hash.slice(0, 12)}`,
      file: filePath,
      language,
      name: basename,
      symbolPath: filename,
      kind: "block" as ChunkKind,
      isExported: false,
      isAsync: false,
      dependencies: deps,
      startLine: 1,
      endLine: lineCount,
      hash,
      content: source,
    };
  }

  private createWindowChunks(
    filePath: string,
    filename: string,
    basename: string,
    language: string,
    allLines: string[],
    deps: string[],
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const step = this.WINDOW_SIZE - this.WINDOW_OVERLAP;
    let windowIndex = 0;

    for (let start = 0; start < allLines.length; start += step) {
      const end = Math.min(start + this.WINDOW_SIZE, allLines.length);
      const windowContent = allLines.slice(start, end).join("\n");
      const windowHash = this.getHash(windowContent);
      const windowStartLine = start + 1;
      const windowEndLine = end;
      const windowName = `${basename}_w${windowIndex}`;

      chunks.push({
        id: `${filename}:w${windowIndex}:${windowHash.slice(0, 12)}`,
        file: filePath,
        language,
        name: windowName,
        symbolPath: `${filename}:w${windowIndex}`,
        kind: "block" as ChunkKind,
        isExported: false,
        isAsync: false,
        dependencies: deps,
        startLine: windowStartLine,
        endLine: windowEndLine,
        hash: windowHash,
        content: windowContent,
      });

      windowIndex++;
      if (end >= allLines.length) break;
    }

    return chunks;
  }

  private extractDependencies(source: string): string[] {
    const deps = new Set<string>();
    let match: RegExpExecArray | null;

    // Python imports
    const pyRegex = /(?:^|\n)\s*(?:from|import)\s+([a-zA-Z0-9_.]+)/g;
    while ((match = pyRegex.exec(source)) !== null) {
      const p = match[1]!;
      deps.add(p.split(".").pop()!);
      deps.add(p);
    }

    // C/C++ includes
    const cppRegex = /#include\s*[<"]([^>"]+)[>"]/g;
    while ((match = cppRegex.exec(source)) !== null) {
      const p = match[1]!;
      deps.add(p);
      deps.add(p.replace(/\.[^/.]+$/, ""));
    }

    // Go imports (inside import blocks)
    const goImportBlockRegex = /import\s*\(\s*([\s\S]*?)\s*\)/g;
    while ((match = goImportBlockRegex.exec(source)) !== null) {
      const block = match[1]!;
      const importLineRegex = /"([^"]+)"/g;
      let lineMatch: RegExpExecArray | null;
      while ((lineMatch = importLineRegex.exec(block)) !== null) {
        const p = lineMatch[1]!;
        deps.add(p);
        const parts = p.split("/");
        deps.add(parts[parts.length - 1]!);
      }
    }

    // Rust use statements
    const rustUseRegex = /\buse\s+([\w:]+)/g;
    while ((match = rustUseRegex.exec(source)) !== null) {
      const p = match[1]!;
      deps.add(p);
      deps.add(p.split("::").pop()!);
    }

    // Java imports
    const javaImportRegex = /\bimport\s+([\w.]+)/g;
    while ((match = javaImportRegex.exec(source)) !== null) {
      const p = match[1]!;
      deps.add(p);
      deps.add(p.split(".").pop()!);
    }

    // Function calls (generic)
    const callRegex = /([a-zA-Z_]\w*)\s*\(/g;
    while ((match = callRegex.exec(source)) !== null) {
      const ident = match[1]!;
      if (!FALLBACK_KEYWORD_BLOCKLIST.has(ident)) {
        deps.add(ident);
      }
    }

    return Array.from(deps);
  }

  private getHash(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    return crypto.createHash("sha1").update(normalized).digest("hex");
  }
}
